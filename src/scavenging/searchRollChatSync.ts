import { resolveActorId } from "../integrations/falloutActor.js";
import { t } from "../integrations/i18n.js";
import { addPartyAp } from "../integrations/falloutApTracker.js";
import { getPartyActorsOnScene } from "./partyContext.js";
import {
  emptyPlayerSearchState,
  initPlayerSearchOnSuccess,
  normalizePlayerSearch,
  type ScavengerPlayerSearchState,
} from "./playerSearchState.js";
import {
  assistSearchFromClientRoll,
  primarySearchFromClientRoll,
  type ClientAssistSearchRoll,
  type ClientPrimarySearchRoll,
} from "./searchSkillRoll.js";
import {
  countAssistBonusSuccesses,
  getSearchTeamRole,
  recordAssistRoll,
  ensureSearchTeam,
} from "./searchTeam.js";
import {
  findRerollWatchByActorId,
  findRerollWatchForAuthor,
  listAllRerollWatches,
  listRerollWatchesForScene,
  onPrimarySearchRerollSucceeded,
  rebuildRerollWatchesForScene,
  type SearchRerollWatch,
  type SearchRerollWatchRole,
} from "./searchRerollWatch.js";
import {
  loadScavengerSceneState,
  savePlayerSearchForScene,
  type ScavengerScenePersistedState,
} from "./scenePersist.js";
import { applySearchTimeToWorldClock } from "./searchWorldClock.js";
import ScavengerSearchApp from "./ScavengerSearchApp.js";

const REROLL_SUFFIX = " re-roll";
const LOC_PLACEHOLDER = "\uE000";

type FalloutChatDie = {
  result: number;
  success?: number;
};

type FalloutChatRollFlags = {
  rollname?: string;
  successTreshold?: number;
  dicesRolled?: FalloutChatDie[];
};

type ChatMessageDoc = {
  id?: string;
  author?: string;
  user?: string;
  speaker?: { actor?: string; token?: string };
  flags?: Record<string, unknown>;
  getFlag?: (scope: string, key: string) => unknown;
  toObject?: () => { flags?: Record<string, unknown> };
};

const syncedMessageIds = new Set<string>();

function rollNamePrefix(i18nKey: string): string {
  const sample = t(i18nKey, { location: LOC_PLACEHOLDER });
  const idx = sample.indexOf(LOC_PLACEHOLDER);
  return idx >= 0 ? sample.slice(0, idx) : sample;
}

function parseScavengeRerollRole(rollname: string): SearchRerollWatchRole | null {
  const trimmed = rollname.trim();
  if (!trimmed.toLowerCase().endsWith(REROLL_SUFFIX)) return null;
  const base = trimmed.slice(0, -REROLL_SUFFIX.length);
  const assistPrefix = rollNamePrefix("WASTELANDER.Scavenging.PlayerSearch.SurvivalAssistRollName");
  const primaryPrefix = rollNamePrefix("WASTELANDER.Scavenging.PlayerSearch.SurvivalSearchRollName");
  if (base.startsWith(assistPrefix)) return "assist";
  if (base.startsWith(primaryPrefix)) return "primary";
  return null;
}

function resolveSpeakerActorId(message: ChatMessageDoc): string | null {
  const raw = message.speaker?.actor;
  if (!raw) return null;
  const doc = game.actors.get(raw);
  if (!doc) return null;
  try {
    return resolveActorId(doc);
  } catch {
    return doc.isToken ? null : doc.id;
  }
}

function isMessageAuthorGm(authorUserId: string | undefined): boolean {
  if (authorUserId) {
    const user = (game as { users?: { get: (id: string) => { isGM?: boolean } | undefined } })
      .users?.get(authorUserId);
    if (user?.isGM) return true;
  }
  return Boolean(game.user?.isGM);
}

/**
 * Match watches for a re-roll chat card. GM-authored rolls (rolling for a player)
 * match by speaker actor or by trying scene assist/primary watches.
 */
function resolveRerollWatchCandidates(
  message: ChatMessageDoc,
  authorUserId: string | undefined,
  role: SearchRerollWatchRole,
): SearchRerollWatch[] {
  const speakerActorId = resolveSpeakerActorId(message);
  if (speakerActorId) {
    const byActor = findRerollWatchByActorId(speakerActorId);
    if (byActor?.role === role) return [byActor];
  }

  if (authorUserId) {
    const byAuthor = findRerollWatchForAuthor(authorUserId);
    if (byAuthor?.role === role) return [byAuthor];
  }

  if (isMessageAuthorGm(authorUserId)) {
    const sceneId = canvas?.scene?.id;
    if (sceneId) return listRerollWatchesForScene(sceneId, role);
    return listAllRerollWatches(role);
  }

  return [];
}

function readFalloutRollFlags(message: ChatMessageDoc): FalloutChatRollFlags | null {
  const candidates: unknown[] = [
    message.flags?.falloutroll,
    message.getFlag?.("fallout", "falloutroll"),
    message.toObject?.()?.flags?.falloutroll,
  ];
  for (const raw of candidates) {
    if (raw && typeof raw === "object") return raw as FalloutChatRollFlags;
  }
  return null;
}

function resolveMessageAuthorId(
  message: ChatMessageDoc,
  hookUserId?: string,
): string | undefined {
  if (hookUserId) return hookUserId;
  if (typeof message.author === "string" && message.author) return message.author;
  if (typeof message.user === "string" && message.user) return message.user;
  return undefined;
}

function preparePlayerSearch(state: ScavengerScenePersistedState): ScavengerPlayerSearchState {
  const base =
    normalizePlayerSearch(state.playerSearch) ?? emptyPlayerSearchState();
  return ensureSearchTeam(base, getPartyActorsOnScene(state.sceneId).map((r) => r.actorId));
}

function buildAssistPayload(
  falloutRoll: FalloutChatRollFlags,
): ClientAssistSearchRoll | null {
  const dices = falloutRoll.dicesRolled;
  if (!dices?.length) return null;
  const faces = dices.map((die) => die.result);
  const successes = dices.reduce((sum, die) => sum + (Number(die.success) || 0), 0);
  const targetNumber = Number(falloutRoll.successTreshold);
  if (!Number.isFinite(targetNumber)) return null;
  return { faces, successes, targetNumber };
}

function buildPrimaryPayload(
  falloutRoll: FalloutChatRollFlags,
  difficulty: number,
): ClientPrimarySearchRoll | null {
  const assist = buildAssistPayload(falloutRoll);
  if (!assist || assist.faces.length < 1) return null;
  return { ...assist, difficulty };
}

async function applyAssistReroll(
  state: ScavengerScenePersistedState,
  actorId: string,
  payload: ClientAssistSearchRoll,
  userId: string,
): Promise<boolean> {
  const actor = game.actors.get(actorId);
  if (!actor) return false;

  let playerSearch = preparePlayerSearch(state);
  if (playerSearch.searchSuccess !== null) return false;
  if (getSearchTeamRole(playerSearch, actorId) !== "assist") return false;

  const existing = playerSearch.assistRolls[actorId];
  if (!existing) return false;

  const parsed = assistSearchFromClientRoll(actor, payload);
  if ("error" in parsed) return false;

  if (
    existing.successes === parsed.successes &&
    existing.face === (parsed.faces[0] ?? 0)
  ) {
    return false;
  }

  const user = (game as { users?: { get: (id: string) => { name?: string } | undefined } })
    .users?.get(userId);

  playerSearch = recordAssistRoll(playerSearch, {
    actorId,
    userId,
    userName: user?.name ?? existing.userName,
    targetNumber: parsed.targetNumber,
    face: parsed.faces[0] ?? 0,
    successes: parsed.successes,
    contributesSuccess: parsed.contributesSuccess,
    detail: `${parsed.detail} (Miss Fortune re-roll)`,
    at: Date.now(),
  });

  await savePlayerSearchForScene(state.sceneId, playerSearch);
  return true;
}

async function applyPrimaryReroll(
  state: ScavengerScenePersistedState,
  actorId: string,
  payload: ClientPrimarySearchRoll,
  userId: string,
): Promise<boolean> {
  const actor = game.actors.get(actorId);
  if (!actor) return false;

  const location = state.location;
  if (!location) return false;

  let playerSearch = preparePlayerSearch(state);
  if (getSearchTeamRole(playerSearch, actorId) !== "primary") return false;

  const log = playerSearch.searchRollLog;
  if (!log || log.actorId !== actorId) return false;

  const parsed = primarySearchFromClientRoll(actor, payload);
  if ("error" in parsed) return false;

  if (playerSearch.searchSuccess === true) return false;

  const unchanged =
    log.successes === parsed.successes &&
    log.faces.join(",") === parsed.faces.join(",") &&
    Boolean(log.success) === parsed.success &&
    playerSearch.searchSuccess === (parsed.success ? true : false);
  if (unchanged) return false;

  const user = (game as { users?: { get: (id: string) => { name?: string } | undefined } })
    .users?.get(userId);
  const userName = user?.name ?? log.userName;
  const assistBonus = countAssistBonusSuccesses(playerSearch);

  if (parsed.success) {
    const totalSuccesses = parsed.successes + assistBonus;
    const bonusAp = Math.max(0, totalSuccesses - parsed.difficulty);
    if (bonusAp > 0) {
      const granted = await addPartyAp(bonusAp);
      if (!granted) return false;
    }

    const preserved = preparePlayerSearch(state);
    playerSearch = initPlayerSearchOnSuccess(location);
    playerSearch.teamRoles = { ...preserved.teamRoles };
    playerSearch.assistRolls = { ...preserved.assistRolls };
    playerSearch.searchRollLog = {
      actorId,
      userId,
      userName,
      targetNumber: parsed.targetNumber,
      difficulty: parsed.difficulty,
      successes: parsed.successes,
      faces: parsed.faces,
      success: true,
      detail: `${parsed.detail}${assistBonus ? `; +${assistBonus} assist success(es)` : ""}${bonusAp ? `; +${bonusAp} party AP` : ""} (Miss Fortune re-roll)`,
      at: Date.now(),
      assistBonusSuccesses: assistBonus,
      totalSuccesses,
      bonusApGranted: bonusAp,
    };
    onPrimarySearchRerollSucceeded(state.sceneId, actorId);
  } else if (playerSearch.searchSuccess === false) {
    playerSearch = {
      ...playerSearch,
      searchSuccess: false,
      searchRollLog: {
        ...log,
        successes: parsed.successes,
        faces: parsed.faces,
        success: false,
        detail: `${parsed.detail} (Miss Fortune re-roll)`,
        totalSuccesses: parsed.successes,
        at: Date.now(),
      },
      updatedAt: Date.now(),
    };
  } else {
    return false;
  }

  playerSearch = await applySearchTimeToWorldClock(location, playerSearch, {
    alreadyAdvanced: playerSearch.searchTimeAdvanced,
  });

  await savePlayerSearchForScene(state.sceneId, playerSearch);
  return true;
}

/**
 * Sync Miss Fortune re-rolls only for users we are actively watching on the GM client.
 */
export async function syncSearchRollFromChatMessage(
  message: ChatMessageDoc,
  hookUserId?: string,
): Promise<void> {
  if (!game.user?.isGM) return;

  const messageId = message.id;
  if (messageId) {
    if (syncedMessageIds.has(messageId)) return;
  }

  const userId = resolveMessageAuthorId(message, hookUserId);

  const falloutRoll = readFalloutRollFlags(message);
  const rollname = falloutRoll?.rollname ?? "";
  const role = parseScavengeRerollRole(rollname);
  if (!falloutRoll || !role) return;

  const candidates = resolveRerollWatchCandidates(message, userId, role);
  if (!candidates.length) return;

  let changed = false;
  let updatedSceneId: string | null = null;

  for (const watch of candidates) {
    const state = loadScavengerSceneState(watch.sceneId);
    if (!state?.location) continue;

    if (role === "assist") {
      const payload = buildAssistPayload(falloutRoll);
      if (!payload) continue;
      const ok = await applyAssistReroll(
        state,
        watch.actorId,
        payload,
        watch.userId,
      );
      if (ok) {
        changed = true;
        updatedSceneId = watch.sceneId;
        break;
      }
    } else {
      const payload = buildPrimaryPayload(falloutRoll, state.location.searchDifficulty);
      if (!payload) continue;
      const ok = await applyPrimaryReroll(
        state,
        watch.actorId,
        payload,
        watch.userId,
      );
      if (ok) {
        changed = true;
        updatedSceneId = watch.sceneId;
        break;
      }
    }
  }

  if (messageId) syncedMessageIds.add(messageId);

  if (changed && updatedSceneId) {
    ScavengerSearchApp.onSceneUpdated(updatedSceneId);
    ui.notifications.info(t("WASTELANDER.Scavenging.PlayerSearch.MissFortuneSynced"));
  }
}

export function registerSearchRollChatSyncHooks(): void {
  const handler = (message: ChatMessageDoc, _options: unknown, userId?: string): void => {
    void syncSearchRollFromChatMessage(message, userId);
  };

  Hooks.on("createChatMessage", handler);
  Hooks.on("renderChatMessageHTML", (message: ChatMessageDoc) => {
    void syncSearchRollFromChatMessage(message);
  });

  Hooks.on("activateScene", (scene: { id?: string }) => {
    if (!game.user?.isGM || !scene?.id) return;
    rebuildRerollWatchesForScene(scene.id);
  });

  Hooks.once("ready", () => {
    if (!game.user?.isGM) return;
    const sceneId = canvas?.scene?.id;
    if (sceneId) rebuildRerollWatchesForScene(sceneId);
  });
}

export {
  clearAllRerollWatches,
  onAssistSearchRollCommitted,
  onPrimarySearchRollCommitted,
} from "./searchRerollWatch.js";
