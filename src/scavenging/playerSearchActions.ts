import { MODULE_ID } from "../constants.js";
import { addPartyAp, getPartyAp, spendPartyAp } from "../integrations/falloutApTracker.js";
import { resolveActor, updateWorldActor } from "../integrations/falloutActor.js";
import type { FalloutActorSystemSlice } from "../export/actorDerivedStats.js";
import type { LootCategoryKey, ScavengerLocation } from "./ScavengerLocation.js";
import { canSearchLocation } from "./problemRules.js";
import { evaluateFoundryRoll } from "../integrations/foundryRoll.js";
import { rollLootCategory } from "./lootRoller.js";
import {
  clampLootRollSum,
  collectTableResultRows,
  entryBaseRollSum,
  lookupLootAtRollSum,
} from "./rollTableLookup.js";
import { findSceneRollTableForCategory } from "./sceneLootTables.js";
import {
  canRollMin,
  canSpendApOnCategory,
  emptyPlayerSearchState,
  getItemRange,
  initPlayerSearchOnSuccess,
  newRollEntryId,
  normalizePlayerSearch,
  remainingMinFor,
  rollsUsedFor,
  type PlayerLootRollEntry,
  type ScavengerPlayerSearchState,
  type SearchTeamRole,
} from "./playerSearchState.js";
import { getPartyActorsOnScene, userControlsActor } from "./partyContext.js";
import {
  applySearchTeamRole,
  countAssistBonusSuccesses,
  ensureSearchTeam,
  getSearchTeamRole,
  isSearchTeamActor,
  primaryCanScavengeSearch,
  recordAssistRoll,
  searchTeamLocked,
} from "./searchTeam.js";
import {
  loadScavengerSceneState,
  savePlayerSearchForScene,
  saveScavengerSceneState,
  type ScavengerScenePersistedState,
} from "./scenePersist.js";
import {
  assistSearchFromClientRoll,
  primarySearchFromClientRoll,
  rollAssistPerSurvival,
  rollPerSurvivalSearch,
  type ClientAssistSearchRoll,
  type ClientPrimarySearchRoll,
} from "./searchSkillRoll.js";
import { postLuckLootFindChat, presentScavengerRoll } from "./scavengerRollChat.js";
import { formatLootCategoryLabel } from "./lootGrid.js";
import { applySearchTimeToWorldClock } from "./searchWorldClock.js";
import {
  clearAllRerollWatches,
  onAssistSearchRollCommitted,
  onPrimarySearchRollCommitted,
  suppressRerollWatchesForUser,
} from "./searchRerollWatch.js";
import { t } from "../integrations/i18n.js";

export type PrimarySearchRollPayload = ClientPrimarySearchRoll;
export type AssistSearchRollPayload = ClientAssistSearchRoll;

export type PlayerSearchSocketAction =
  | {
      action: "searchRoll";
      sceneId: string;
      actorId: string;
      /** Primary search rolled via Fallout Dialog2d20 on the client (includes extra AP dice). */
      primaryRoll?: PrimarySearchRollPayload;
      /** Assist search rolled via Fallout Dialog2d20 on the client (1d20). */
      assistRoll?: AssistSearchRollPayload;
    }
  | {
      action: "setSearchTeamRole";
      sceneId: string;
      actorId: string;
      role: SearchTeamRole;
    }
  | {
      action: "lootRollMin";
      sceneId: string;
      actorId: string;
      category: LootCategoryKey;
    }
  | {
      action: "lootRollAp";
      sceneId: string;
      actorId: string;
      category: LootCategoryKey;
    }
  | {
      action: "luckAdjust";
      sceneId: string;
      actorId: string;
      entryId: string;
      delta: 1 | -1;
    }
  | {
      action: "luckJump";
      sceneId: string;
      actorId: string;
      entryId: string;
      targetShift: number;
    }
  | {
      action: "gmSetSearchOutcome";
      sceneId: string;
      outcome: "success" | "fail" | "reset";
    }
  | {
      action: "closeRerollWatches";
      sceneId: string;
    };

export type PlayerSearchActionResult =
  | { ok: true; state: ScavengerScenePersistedState }
  | { ok: false; error: string };

function getUser(userId: string): { id: string; name: string } | undefined {
  const users = (game as { users?: { get: (id: string) => { id: string; name: string } | undefined } })
    .users;
  return users?.get(userId);
}

function requireSceneState(
  sceneId: string,
): { state: ScavengerScenePersistedState; location: ScavengerLocation } | { error: string } {
  const state = loadScavengerSceneState(sceneId);
  if (!state?.location) {
    return { error: t("WASTELANDER.Scavenging.PlayerSearch.NoLocation") };
  }
  return { state, location: state.location };
}

function tableRowsForLuck(
  location: ScavengerLocation,
  rollCategory: LootCategoryKey,
) {
  const sceneTable = findSceneRollTableForCategory(location, rollCategory);
  return sceneTable ? collectTableResultRows(sceneTable) : null;
}

function partyActorIdsForScene(sceneId: string): string[] {
  return getPartyActorsOnScene(sceneId).map((r) => r.actorId);
}

function assertActorOwnedByUser(
  actorId: string,
  userId: string,
  sceneId: string,
): boolean {
  return userControlsActor(actorId, userId, sceneId);
}

function preparePlayerSearch(
  state: ScavengerScenePersistedState,
): ScavengerPlayerSearchState {
  const base =
    normalizePlayerSearch(state.playerSearch) ?? emptyPlayerSearchState();
  return ensureSearchTeam(base, partyActorIdsForScene(state.sceneId));
}

function getOrInitPlayerSearch(
  state: ScavengerScenePersistedState,
): ScavengerPlayerSearchState | undefined {
  const raw = normalizePlayerSearch(state.playerSearch);
  if (!raw && state.playerSearch === undefined) return undefined;
  return preparePlayerSearch(state);
}

async function persistPlayerSearch(
  state: ScavengerScenePersistedState,
  playerSearch: ScavengerPlayerSearchState | undefined,
): Promise<ScavengerScenePersistedState> {
  await savePlayerSearchForScene(
    state.sceneId,
    playerSearch ?? null,
  );
  const reloaded = loadScavengerSceneState(state.sceneId);
  if (!reloaded) {
    return {
      ...state,
      playerSearch: undefined,
      updatedAt: Date.now(),
    };
  }
  return reloaded;
}

function getActorLuck(actor: Actor): number {
  const system = actor.system as FalloutActorSystemSlice;
  return Math.max(0, Math.floor(Number(system.luckPoints ?? 0)));
}

async function postLootRollChat(
  category: LootCategoryKey,
  label: string,
  rollSum: number,
): Promise<void> {
  const formula = category === "oddities" ? "3d20" : "2d20";
  const roll = await evaluateFoundryRoll(formula, { animate: false });
  await presentScavengerRoll({
    roll,
    formula,
    label: t("WASTELANDER.Scavenging.PlayerSearch.LootRollChat", { category: label }),
    total: rollSum,
    detail: label,
  });
}

export async function executePlayerSearchAction(
  data: PlayerSearchSocketAction,
  userId: string,
): Promise<PlayerSearchActionResult> {
  if (!game.user?.isGM) {
    return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.GmOnlyMutation") };
  }

  try {
    return await executePlayerSearchActionInner(data, userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

async function executePlayerSearchActionInner(
  data: PlayerSearchSocketAction,
  userId: string,
): Promise<PlayerSearchActionResult> {
  if (data.action === "gmSetSearchOutcome") {
    const loaded = requireSceneState(data.sceneId);
    if ("error" in loaded) return { ok: false, error: loaded.error };
    const { state, location } = loaded;

    const previousSearch = normalizePlayerSearch(state.playerSearch);
    let playerSearch: ScavengerPlayerSearchState | undefined;
    if (data.outcome === "reset") {
      playerSearch = undefined;
      clearAllRerollWatches(state.sceneId);
    } else if (data.outcome === "success") {
      playerSearch = await applySearchTimeToWorldClock(
        location,
        initPlayerSearchOnSuccess(location),
        { alreadyAdvanced: previousSearch?.searchTimeAdvanced },
      );
    } else {
      playerSearch = await applySearchTimeToWorldClock(
        location,
        {
          ...emptyPlayerSearchState(),
          searchSuccess: false,
        },
        { alreadyAdvanced: previousSearch?.searchTimeAdvanced },
      );
    }

    const next = await persistPlayerSearch(state, playerSearch);
    if (data.outcome === "success" || data.outcome === "fail") {
      clearAllRerollWatches(state.sceneId);
    }
    return { ok: true, state: next };
  }

  if (data.action === "closeRerollWatches") {
    suppressRerollWatchesForUser(data.sceneId, userId);
    const loaded = requireSceneState(data.sceneId);
    if ("error" in loaded) return { ok: false, error: loaded.error };
    return { ok: true, state: loaded.state };
  }

  const loaded = requireSceneState(data.sceneId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { state, location } = loaded;

  if (!canSearchLocation(location.problems)) {
    return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.ObstacleBlocked") };
  }

  let playerSearch = preparePlayerSearch(state);

  if (data.action === "setSearchTeamRole") {
    if (playerSearch.searchSuccess !== null) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.TeamLocked") };
    }
    if (searchTeamLocked(playerSearch)) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.TeamLocked") };
    }
    if (!partyActorIdsForScene(data.sceneId).includes(data.actorId)) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.ActorNotFound") };
    }

    playerSearch = applySearchTeamRole(playerSearch, data.actorId, data.role);
    const next = await persistPlayerSearch(state, playerSearch);
    return { ok: true, state: next };
  }

  if (data.action === "searchRoll") {
    if (playerSearch.searchSuccess === true) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.AlreadySucceeded") };
    }
    if (playerSearch.searchSuccess === false) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.SearchFailed") };
    }

    const actor = game.actors.get(data.actorId);
    if (!actor) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.ActorNotFound") };
    }
    if (!assertActorOwnedByUser(data.actorId, userId, data.sceneId)) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.NotYourCharacter") };
    }

    const user = getUser(userId);
    const role = getSearchTeamRole(playerSearch, data.actorId);

    if (role === "assist") {
      if (playerSearch.assistRolls[data.actorId]) {
        return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.AssistAlreadyRolled") };
      }

      let test;
      if (data.assistRoll) {
        const parsed = assistSearchFromClientRoll(actor, data.assistRoll);
        if ("error" in parsed) {
          return {
            ok: false,
            error: t("WASTELANDER.Scavenging.PlayerSearch.InvalidAssistRoll"),
          };
        }
        test = parsed;
      } else {
        test = await rollAssistPerSurvival(actor);
      }
      playerSearch = ensureSearchTeam(playerSearch, partyActorIdsForScene(data.sceneId));
      playerSearch = recordAssistRoll(playerSearch, {
        actorId: data.actorId,
        userId,
        userName: user?.name ?? "Unknown",
        targetNumber: test.targetNumber,
        face: test.faces[0] ?? 0,
        successes: test.successes,
        contributesSuccess: test.contributesSuccess,
        detail: test.detail,
        at: Date.now(),
      });

      const next = await persistPlayerSearch(state, playerSearch);
      onAssistSearchRollCommitted(state.sceneId, data.actorId, userId);
      return { ok: true, state: next };
    }

    if (role !== "primary") {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.NotPrimarySearcher") };
    }
    if (!primaryCanScavengeSearch(playerSearch, partyActorIdsForScene(data.sceneId))) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.AssistsPending") };
    }
    if (playerSearch.searchRollLog) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.PrimaryAlreadyRolled") };
    }

    let test;
    if (data.primaryRoll) {
      if (data.primaryRoll.difficulty !== location.searchDifficulty) {
        return {
          ok: false,
          error: t("WASTELANDER.Scavenging.PlayerSearch.InvalidPrimaryRoll"),
        };
      }
      const parsed = primarySearchFromClientRoll(actor, data.primaryRoll);
      if ("error" in parsed) {
        return {
          ok: false,
          error: t("WASTELANDER.Scavenging.PlayerSearch.InvalidPrimaryRoll"),
        };
      }
      test = parsed;
    } else {
      test = await rollPerSurvivalSearch(actor, location.searchDifficulty);
    }
    const assistBonus = countAssistBonusSuccesses(playerSearch);

    if (test.success) {
      const totalSuccesses = test.successes + assistBonus;
      const bonusAp = Math.max(0, totalSuccesses - test.difficulty);
      if (bonusAp > 0) {
        const granted = await addPartyAp(bonusAp);
        if (!granted) {
          return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.BonusApFailed") };
        }
      }

      playerSearch = initPlayerSearchOnSuccess(location);
      playerSearch.teamRoles = { ...preparePlayerSearch(state).teamRoles };
      playerSearch.assistRolls = { ...preparePlayerSearch(state).assistRolls };
      playerSearch.searchRollLog = {
        actorId: data.actorId,
        userId,
        userName: user?.name ?? "Unknown",
        targetNumber: test.targetNumber,
        difficulty: test.difficulty,
        successes: test.successes,
        faces: test.faces,
        success: true,
        detail: `${test.detail}${assistBonus ? `; +${assistBonus} assist success(es)` : ""}${bonusAp ? `; +${bonusAp} party AP` : ""}`,
        at: Date.now(),
        assistBonusSuccesses: assistBonus,
        totalSuccesses,
        bonusApGranted: bonusAp,
      };
    } else {
      playerSearch = {
        ...playerSearch,
        searchSuccess: false,
        searchRollLog: {
          actorId: data.actorId,
          userId,
          userName: user?.name ?? "Unknown",
          targetNumber: test.targetNumber,
          difficulty: test.difficulty,
          successes: test.successes,
          faces: test.faces,
          success: false,
          detail: test.detail,
          at: Date.now(),
          assistBonusSuccesses: 0,
          totalSuccesses: test.successes,
          bonusApGranted: 0,
        },
        remainingMin: {},
        rollsUsed: {},
        entries: [],
        updatedAt: Date.now(),
      };
    }

    playerSearch = await applySearchTimeToWorldClock(location, playerSearch);

    const next = await persistPlayerSearch(state, playerSearch);
    onPrimarySearchRollCommitted(state.sceneId, data.actorId, userId, test.success);
    return { ok: true, state: next };
  }

  playerSearch = getOrInitPlayerSearch(state) ?? playerSearch;
  if (!playerSearch || playerSearch.searchSuccess !== true) {
    return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.NeedSearchSuccess") };
  }

  const actor = game.actors.get(data.actorId);
  if (!actor) {
    return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.ActorNotFound") };
  }
  const user = getUser(userId);

  if (data.action === "lootRollMin" || data.action === "lootRollAp") {
    const category = data.category;
    const item = getItemRange(location, category);
    if (!item) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.UnknownCategory") };
    }

    if (data.action === "lootRollMin") {
      if (!canRollMin(playerSearch, location, category)) {
        return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.CannotRollMin") };
      }
    } else {
      if (!canSpendApOnCategory(playerSearch, location, category)) {
        return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.CannotSpendAp") };
      }
      const spent = await spendPartyAp(1);
      if (!spent) {
        return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.NoPartyAp") };
      }
    }

    const drawn = await rollLootCategory(category, 0, { location });
    const skipLootChat = drawn.drewToChat === true;
    const entry: PlayerLootRollEntry = {
      id: newRollEntryId(),
      category,
      resolvedTableCategory: drawn.tableCategory,
      source: data.action === "lootRollMin" ? "min" : "ap",
      actorId: data.actorId,
      userId,
      userName: user?.name ?? "Unknown",
      label: drawn.quantity
        ? `${drawn.label} (×${drawn.quantity})`
        : drawn.label,
      itemUuid: drawn.itemUuid,
      baseRollSum: drawn.rollSum,
      rollSum: drawn.rollSum,
      quantityFormula: drawn.formula,
      luckShift: 0,
      luckSpent: 0,
      createdAt: Date.now(),
    };

    if (data.action === "lootRollMin") {
      const rem = remainingMinFor(playerSearch, category);
      playerSearch.remainingMin[category] = Math.max(0, rem - 1);
    }
    playerSearch.rollsUsed[category] = rollsUsedFor(playerSearch, category) + 1;
    playerSearch.entries = [...playerSearch.entries, entry];
    playerSearch.updatedAt = Date.now();

    if (!skipLootChat) {
      await postLootRollChat(category, entry.label, entry.rollSum);
    }

    const next = await persistPlayerSearch(state, playerSearch);
    return { ok: true, state: next };
  }

  if (data.action === "luckAdjust") {
    const entry = playerSearch.entries.find((e) => e.id === data.entryId);
    if (!entry) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.EntryNotFound") };
    }
    if (!isSearchTeamActor(playerSearch, data.actorId)) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.NotSearchTeamActor") };
    }
    if (!assertActorOwnedByUser(data.actorId, userId, data.sceneId)) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.NotYourCharacter") };
    }

    const maxShift = location.level;
    const nextShift = entry.luckShift + data.delta;
    if (nextShift > maxShift || nextShift < -maxShift) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.LuckShiftLimit", { max: maxShift }) };
    }

    const luck = getActorLuck(resolveActor(actor));
    if (luck < 1) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.NoLuck") };
    }

    const rollCategory = entry.resolvedTableCategory ?? entry.category;
    const base = entryBaseRollSum(entry);
    const rollSum = clampLootRollSum(rollCategory, base + nextShift);
    const looked = await lookupLootAtRollSum(
      rollCategory,
      rollSum,
      tableRowsForLuck(location, rollCategory),
    );
    entry.luckShift = nextShift;
    entry.luckSpent += 1;
    entry.rollSum = looked.rollSum;
    entry.label = looked.label;
    entry.itemUuid = looked.itemUuid;
    playerSearch.updatedAt = Date.now();

    await updateWorldActor(data.actorId, {
      "system.luckPoints": luck - 1,
    });

    await postLuckLootFindChat({
      actor,
      luckSpent: 1,
      itemLabel: entry.label,
      categoryLabel: formatLootCategoryLabel(entry.category),
      rollSum: entry.rollSum,
    });

    const next = await persistPlayerSearch(state, playerSearch);
    return { ok: true, state: next };
  }

  if (data.action === "luckJump") {
    const entry = playerSearch.entries.find((e) => e.id === data.entryId);
    if (!entry) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.EntryNotFound") };
    }
    if (!isSearchTeamActor(playerSearch, data.actorId)) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.NotSearchTeamActor") };
    }
    if (!assertActorOwnedByUser(data.actorId, userId, data.sceneId)) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.NotYourCharacter") };
    }

    const maxShift = location.level;
    const targetShift = Math.trunc(data.targetShift);
    if (targetShift > maxShift || targetShift < -maxShift) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.LuckShiftLimit", { max: maxShift }) };
    }

    const jumpCost = Math.abs(targetShift - entry.luckShift);
    if (jumpCost === 0) {
      const next = await persistPlayerSearch(state, playerSearch);
      return { ok: true, state: next };
    }

    const luck = getActorLuck(resolveActor(actor));
    if (luck < jumpCost) {
      return {
        ok: false,
        error: t("WASTELANDER.Scavenging.PlayerSearch.NoLuckForJump", {
          cost: jumpCost,
          have: luck,
        }),
      };
    }

    const rollCategory = entry.resolvedTableCategory ?? entry.category;
    const base = entryBaseRollSum(entry);
    const rollSum = clampLootRollSum(rollCategory, base + targetShift);
    const looked = await lookupLootAtRollSum(
      rollCategory,
      rollSum,
      tableRowsForLuck(location, rollCategory),
    );
    entry.luckShift = targetShift;
    entry.luckSpent += jumpCost;
    entry.rollSum = looked.rollSum;
    entry.label = looked.label;
    entry.itemUuid = looked.itemUuid;
    playerSearch.updatedAt = Date.now();

    await updateWorldActor(data.actorId, {
      "system.luckPoints": luck - jumpCost,
    });

    await postLuckLootFindChat({
      actor,
      luckSpent: jumpCost,
      itemLabel: entry.label,
      categoryLabel: formatLootCategoryLabel(entry.category),
      rollSum: entry.rollSum,
    });

    const next = await persistPlayerSearch(state, playerSearch);
    return { ok: true, state: next };
  }

  return { ok: false, error: "Unknown action" };
}

export async function requestPlayerSearchAction(
  data: PlayerSearchSocketAction,
): Promise<PlayerSearchActionResult> {
  if (game.user?.isGM) {
    return executePlayerSearchAction(data, game.user.id);
  }

  const socket = (game as { socket?: { emit: (channel: string, data: unknown) => void } })
    .socket;
  if (!socket?.emit) {
    return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.SocketUnavailable") };
  }

  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const channel = `module.${MODULE_ID}`;
  const payload = { ...data, _requestId: requestId, userId: game.user?.id };

  const sock = game as {
    socket?: {
      emit: (channel: string, data: unknown) => void;
      on: (channel: string, fn: (data: unknown) => void) => void;
      off: (channel: string, fn: (data: unknown) => void) => void;
    };
  };

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      sock.socket?.off(channel, handler);
      resolve({ ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.GmOffline") });
    }, 15000);

    const handler = (response: unknown): void => {
      const msg = response as SocketPayload & {
        _targetUserId?: string;
        state?: ScavengerScenePersistedState;
        error?: string;
      };
      if (!isPlayerSearchSocketResponse(msg)) return;
      if (msg._requestId !== requestId) return;
      if (msg._targetUserId && msg._targetUserId !== game.user?.id) return;
      window.clearTimeout(timeout);
      sock.socket?.off(channel, handler);
      if (msg.ok && msg.state) {
        resolve({ ok: true, state: msg.state });
      } else {
        resolve({ ok: false, error: msg.error ?? "Request failed" });
      }
    };

    sock.socket?.on(channel, handler);
    socket.emit(channel, payload);
  });
}

type SocketPayload = PlayerSearchSocketAction & {
  _requestId?: string;
  userId?: string;
  ok?: boolean;
};

export function isPlayerSearchSocketRequest(data: SocketPayload): boolean {
  return Boolean(data.action) && typeof data.ok !== "boolean";
}

export function isPlayerSearchSocketResponse(
  data: SocketPayload,
): data is SocketPayload & { ok: boolean; _requestId: string } {
  return typeof data._requestId === "string" && typeof data.ok === "boolean";
}

export async function handlePlayerSearchSocket(
  data: SocketPayload,
): Promise<void> {
  if (!game.user?.isGM) return;
  if (!isPlayerSearchSocketRequest(data)) return;

  const userId = data.userId ?? game.user.id;
  const { _requestId, userId: _uid, ok: _ok, ...actionData } = data;
  const result = await executePlayerSearchAction(
    actionData as PlayerSearchSocketAction,
    userId,
  );

  const channel = `module.${MODULE_ID}`;
  const socket = (game as { socket?: { emit: (channel: string, data: unknown) => void } })
    .socket;
  if (!socket?.emit || !_requestId) return;

  socket.emit(channel, {
    _requestId,
    _targetUserId: userId,
    ok: result.ok,
    state: result.ok ? result.state : undefined,
    error: result.ok ? undefined : result.error,
  });
}

/** Fire-and-forget: stop Miss Fortune chat watches when the Scavenge window closes. */
export function notifyScavengeSearchAppClosed(sceneId: string): void {
  if (!sceneId) return;
  const userId = game.user?.id;
  if (!userId) return;
  if (game.user?.isGM) {
    suppressRerollWatchesForUser(sceneId, userId);
    return;
  }
  const channel = `module.${MODULE_ID}`;
  const socket = (game as { socket?: { emit: (channel: string, data: unknown) => void } })
    .socket;
  socket?.emit(channel, {
    action: "closeRerollWatches",
    sceneId,
    userId: game.user?.id,
  });
}

export async function readPartyApForDisplay(): Promise<{
  value: number | null;
  available: boolean;
}> {
  const value = await getPartyAp();
  return { value, available: value !== null };
}
