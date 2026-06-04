import { MODULE_ID } from "../constants.js";
import { getPartyAp, spendPartyAp } from "../integrations/falloutApTracker.js";
import { resolveActor, updateWorldActor } from "../integrations/falloutActor.js";
import type { FalloutActorSystemSlice } from "../export/actorDerivedStats.js";
import type { LootCategoryKey, ScavengerLocation } from "./ScavengerLocation.js";
import { canSearchLocation } from "./problemRules.js";
import { evaluateFoundryRoll } from "../integrations/foundryRoll.js";
import { rollLootCategory } from "./lootRoller.js";
import {
  clampLootRollSum,
  entryBaseRollSum,
  lookupLootAtRollSum,
} from "./rollTableLookup.js";
import {
  canRollMin,
  canSpendApOnCategory,
  getItemRange,
  initPlayerSearchOnSuccess,
  newRollEntryId,
  normalizePlayerSearch,
  remainingMinFor,
  rollsUsedFor,
  type PlayerLootRollEntry,
  type ScavengerPlayerSearchState,
} from "./playerSearchState.js";
import {
  loadScavengerSceneState,
  savePlayerSearchForScene,
  type ScavengerScenePersistedState,
} from "./scenePersist.js";
import { rollPerSurvivalSearch } from "./searchSkillRoll.js";
import { presentScavengerRoll } from "./scavengerRollChat.js";
import { t } from "../integrations/i18n.js";

export type PlayerSearchSocketAction =
  | {
      action: "searchRoll";
      sceneId: string;
      actorId: string;
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

function getOrInitPlayerSearch(
  state: ScavengerScenePersistedState,
): ScavengerPlayerSearchState | undefined {
  return normalizePlayerSearch(state.playerSearch) ?? undefined;
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

    let playerSearch: ScavengerPlayerSearchState | undefined;
    if (data.outcome === "reset") {
      playerSearch = undefined;
    } else if (data.outcome === "success") {
      playerSearch = initPlayerSearchOnSuccess(location);
    } else {
      playerSearch = {
        version: 1,
        searchSuccess: false,
        remainingMin: {},
        rollsUsed: {},
        entries: [],
        updatedAt: Date.now(),
      };
    }

    const next = await persistPlayerSearch(state, playerSearch);
    return { ok: true, state: next };
  }

  const loaded = requireSceneState(data.sceneId);
  if ("error" in loaded) return { ok: false, error: loaded.error };
  const { state, location } = loaded;

  if (!canSearchLocation(location.problems)) {
    return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.ObstacleBlocked") };
  }

  if (data.action === "searchRoll") {
    if (getOrInitPlayerSearch(state)?.searchSuccess === true) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.AlreadySucceeded") };
    }

    const actor = game.actors.get(data.actorId);
    if (!actor) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.ActorNotFound") };
    }

    const user = getUser(userId);
    const test = await rollPerSurvivalSearch(actor, location.searchDifficulty);
    let playerSearch: ScavengerPlayerSearchState;

    if (test.success) {
      playerSearch = initPlayerSearchOnSuccess(location);
      playerSearch.searchRollLog = {
        actorId: data.actorId,
        userId,
        userName: user?.name ?? "Unknown",
        targetNumber: test.targetNumber,
        difficulty: test.difficulty,
        successes: test.successes,
        faces: test.faces,
        success: true,
        detail: test.detail,
        at: Date.now(),
      };
    } else {
      playerSearch = {
        version: 1,
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
        },
        remainingMin: {},
        rollsUsed: {},
        entries: [],
        updatedAt: Date.now(),
      };
    }

    const next = await persistPlayerSearch(state, playerSearch);
    return { ok: true, state: next };
  }

  let playerSearch = getOrInitPlayerSearch(state);
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

    const drawn = await rollLootCategory(category, 0);
    const skipLootChat = drawn.drewToChat === true;
    const entry: PlayerLootRollEntry = {
      id: newRollEntryId(),
      category,
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
    if (entry.actorId !== data.actorId) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.NotYourRoll") };
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

    const base = entryBaseRollSum(entry);
    const rollSum = clampLootRollSum(entry.category, base + nextShift);
    const looked = await lookupLootAtRollSum(entry.category, rollSum);
    entry.luckShift = nextShift;
    entry.luckSpent += 1;
    entry.rollSum = looked.rollSum;
    entry.label = looked.label;
    entry.itemUuid = looked.itemUuid;
    playerSearch.updatedAt = Date.now();

    await updateWorldActor(data.actorId, {
      "system.luckPoints": luck - 1,
    });

    const next = await persistPlayerSearch(state, playerSearch);
    return { ok: true, state: next };
  }

  if (data.action === "luckJump") {
    const entry = playerSearch.entries.find((e) => e.id === data.entryId);
    if (!entry) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.EntryNotFound") };
    }
    if (entry.actorId !== data.actorId) {
      return { ok: false, error: t("WASTELANDER.Scavenging.PlayerSearch.NotYourRoll") };
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

    const base = entryBaseRollSum(entry);
    const rollSum = clampLootRollSum(entry.category, base + targetShift);
    const looked = await lookupLootAtRollSum(entry.category, rollSum);
    entry.luckShift = targetShift;
    entry.luckSpent += jumpCost;
    entry.rollSum = looked.rollSum;
    entry.label = looked.label;
    entry.itemUuid = looked.itemUuid;
    playerSearch.updatedAt = Date.now();

    await updateWorldActor(data.actorId, {
      "system.luckPoints": luck - jumpCost,
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
      const msg = response as {
        _requestId?: string;
        ok?: boolean;
        state?: ScavengerScenePersistedState;
        error?: string;
      };
      if (msg._requestId !== requestId) return;
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
  return Boolean(data.action) && data.ok === undefined;
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
    ok: result.ok,
    state: result.ok ? result.state : undefined,
    error: result.ok ? undefined : result.error,
  });
}

export async function readPartyApForDisplay(): Promise<{
  value: number | null;
  available: boolean;
}> {
  const value = await getPartyAp();
  return { value, available: value !== null };
}
