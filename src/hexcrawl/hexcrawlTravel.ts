import { t } from "../integrations/i18n.js";
import { scavengerConfirmDialog } from "../scavenging/scavengerConfirm.js";
import { currentUserIsOverseer } from "../integrations/overseerAccess.js";
import { getPartyActorsOnScene } from "../scavenging/partyContext.js";
import { getSceneDocument } from "../scavenging/scenePersist.js";
import { rollHexcrawlCampEncounter, rollHexcrawlEncounter } from "./encounterRoll.js";
import {
  collectMovementHexKeys,
  findSceneTokenIdForActor,
  getHexKeyFromTokenDocument,
  tokenPositionForHexKey,
  tokenPositionForHexKeyOnScene,
} from "./hexCoords.js";
import { applyPartyTravelFatigue } from "./applyTravelFatigue.js";
import {
  appendJourneyLog,
  appendTraveledHexKey,
  loadHexcrawlSceneState,
  resetMilesTraveledCumulative,
  saveHexcrawlSceneState,
  type HexcrawlSceneState,
} from "./hexcrawlScenePersist.js";
import { getSceneMilesPerHex } from "./sceneGrid.js";
import { filterHexcrawlTravelRoleActorIds } from "./partyTravel.js";
import { refreshHexcrawlMapOverlay } from "./hexcrawlMapOverlay.js";
import {
  applyHexEntryFogEffects,
  discoverPoiOnHexEntry,
  resolveTerrainForHex,
} from "./hexAnnotations.js";
import {
  clampDifficulty,
  computeTravelFatigueDelta,
  hexTravelMinutes,
  navigationConditionById,
  resolvePartyTravelMph,
  travelEncounterRollCount,
} from "./travelRules.js";
import { getWorldClockLabel } from "../integrations/worldClock.js";
import { applyHexTravelToWorldClock } from "./travelWorldClock.js";

/** In-memory guard so reset suppresses travel before persisted state is read by async hooks. */
const resetTravelActiveScenes = new Set<string>();

/** One hex entry (including encounter rolls) at a time per scene. */
const travelHexEntryTailByScene = new Map<string, Promise<void>>();

function enqueueTravelHexEntry(sceneId: string, run: () => Promise<void>): Promise<void> {
  const previous = travelHexEntryTailByScene.get(sceneId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  travelHexEntryTailByScene.set(sceneId, next);
  return next.finally(() => {
    if (travelHexEntryTailByScene.get(sceneId) === next) {
      travelHexEntryTailByScene.delete(sceneId);
    }
  });
}

export function markResetTravelActive(sceneId: string): void {
  resetTravelActiveScenes.add(sceneId);
}

export function unmarkResetTravelActive(sceneId: string): void {
  resetTravelActiveScenes.delete(sceneId);
}

export async function clearResetTravelPending(sceneId: string): Promise<void> {
  unmarkResetTravelActive(sceneId);
  const state = loadHexcrawlSceneState(sceneId);
  if (!state?.resetTravelPending) return;
  await saveHexcrawlSceneState({ ...state, resetTravelPending: null }, { writeHexMap: false });
}

/** True while a reset token reposition is in progress (skip one-hex constraint). */
export function isResetTravelSuppressed(sceneId: string): boolean {
  if (resetTravelActiveScenes.has(sceneId)) return true;
  const state = loadHexcrawlSceneState(sceneId);
  return Boolean(state?.resetTravelPending);
}

export function resolveTravelTokenId(
  sceneId: string,
  state: Pick<HexcrawlSceneState, "travelTokenId" | "navigatorActorId">,
): string | null {
  const scene = (game as { scenes?: { get: (id: string) => { tokens?: { get: (id: string) => unknown } } | undefined } })
    .scenes?.get(sceneId);
  if (state.travelTokenId && scene?.tokens?.get(state.travelTokenId)) {
    return state.travelTokenId;
  }
  if (state.navigatorActorId) {
    return findSceneTokenIdForActor(sceneId, state.navigatorActorId);
  }
  return state.travelTokenId;
}

/** True when this token is the party travel token or the navigator's scene token. */
export function tokenQualifiesForHexEntry(
  sceneId: string,
  state: Pick<HexcrawlSceneState, "travelTokenId" | "navigatorActorId">,
  tokenId: string,
): boolean {
  const travelTokenId = resolveTravelTokenId(sceneId, state);
  if (travelTokenId && travelTokenId === tokenId) return true;
  if (!state.navigatorActorId) return false;
  return findSceneTokenIdForActor(sceneId, state.navigatorActorId) === tokenId;
}

export function shouldConstrainTravelTokenMove(
  sceneId: string,
  tokenId: string,
): boolean {
  if (isResetTravelSuppressed(sceneId)) return false;
  const state = loadHexcrawlSceneState(sceneId);
  if (!state?.enabled || state.arrived) return false;
  const travelTokenId = resolveTravelTokenId(sceneId, state);
  if (!travelTokenId || travelTokenId !== tokenId) return false;
  return true;
}

type TokenMovementLike = {
  passed?: unknown;
  destination?: { x?: number; y?: number; width?: number; height?: number };
};

type TokenDocForHex = {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  getOccupiedGridSpaceOffsets?: (
    data?: Partial<{ x: number; y: number; width: number; height: number }>,
  ) => Array<{ i: number; j: number }>;
  getSize?: (data?: Partial<{ width: number; height: number }>) => {
    width: number;
    height: number;
  };
};

/**
 * Returns true when this movement was consumed by an in-progress travel reset
 * (no clock, hours, or encounter processing should run).
 */
export async function handleResetTravelMovement(
  sceneId: string,
  doc: TokenDocForHex,
  movement: TokenMovementLike,
): Promise<boolean> {
  const state = loadHexcrawlSceneState(sceneId);
  const pending = state?.resetTravelPending;
  const active = resetTravelActiveScenes.has(sceneId) || Boolean(pending);
  if (!active) return false;

  const hexKeys = collectMovementHexKeys(doc, movement);
  const arrived =
    Boolean(pending) &&
    doc.id === pending!.tokenId &&
    hexKeys.includes(pending!.untilHexKey);

  if (arrived && state) {
    await saveHexcrawlSceneState({ ...state, resetTravelPending: null }, { writeHexMap: false });
    unmarkResetTravelActive(sceneId);
  }

  return true;
}

/** Clear reset suppression once the moved token has reached the starting hex. */
export async function finishResetTravelIfArrived(
  sceneId: string,
  tokenId: string,
): Promise<void> {
  if (!resetTravelActiveScenes.has(sceneId)) return;

  const state = loadHexcrawlSceneState(sceneId);
  const pending = state?.resetTravelPending;
  if (!pending || pending.tokenId !== tokenId) {
    unmarkResetTravelActive(sceneId);
    return;
  }

  const scene = (game as { scenes?: { get: (id: string) => SceneWithTokens | undefined } })
    .scenes?.get(sceneId);
  const tokenDoc = scene?.tokens?.get(tokenId);
  if (!tokenDoc) return;

  const hexKey = getHexKeyFromTokenDocument(tokenDoc);
  if (hexKey === pending.untilHexKey) {
    await clearResetTravelPending(sceneId);
  }
}

async function appendTravelEncounters(
  state: HexcrawlSceneState,
  hexKey: string | undefined,
  rollCount: number,
): Promise<HexcrawlSceneState> {
  let next = state;
  for (let i = 0; i < rollCount; i += 1) {
    const encounter = await rollHexcrawlEncounter();
    next = appendJourneyLog(next, {
      kind: "encounter",
      travelDay: state.travelDay,
      hexKey,
      encounterType: encounter.encounterType,
      encounterName: encounter.encounterName,
      encounterDescription: encounter.encounterDescription,
      cdFaces: encounter.cdFaces,
      cdEffects: encounter.cdEffects,
      note: encounter.error,
    });
  }
  return next;
}

function applyPendingDayEndIfNeeded(state: HexcrawlSceneState): HexcrawlSceneState {
  if (state.hoursTraveledToday < state.maxHoursPerDay || state.pendingDayEnd) {
    return state;
  }
  let next: HexcrawlSceneState = {
    ...state,
    pendingDayEnd: true,
    courseCheckResolved: false,
  };
  next = appendJourneyLog(next, {
    kind: "dayEnded",
    travelDay: next.travelDay,
    note: String(next.hoursTraveledToday),
  });
  ui.notifications.info(t("WASTELANDER.Hexcrawl.Notify.DayEnd"));
  return next;
}

async function applyTravelMinutes(params: {
  state: HexcrawlSceneState;
  sceneId: string;
  hexKey: string | undefined;
  minutes: number;
  mph: number;
  clockNote?: string;
  onHexEntry: boolean;
}): Promise<HexcrawlSceneState> {
  const { state, sceneId, hexKey, minutes, mph, clockNote, onHexEntry } = params;
  const scene = getSceneDocument(sceneId);
  const sceneName = scene?.name?.trim() ?? t("WASTELANDER.Hexcrawl.Journal.UnnamedScene");
  const hoursBefore = state.hoursTraveledToday;
  const clockBefore = getWorldClockLabel();
  const hoursAfter = hoursBefore + minutes / 60;

  const fatigueDelta = computeTravelFatigueDelta(
    hoursBefore,
    hoursAfter,
    state.maxHoursPerDay,
  );
  if (fatigueDelta > 0) {
    await applyPartyTravelFatigue(state.partyActorIds, fatigueDelta);
  }

  let next: HexcrawlSceneState = {
    ...state,
    hoursTraveledToday: hoursAfter,
  };

  if (minutes > 0) {
    const clockResult = await applyHexTravelToWorldClock({
      sceneName,
      hexKey: hexKey ?? "—",
      minutes,
    });
    next = appendJourneyLog(next, {
      kind: "clockAdvanced",
      travelDay: state.travelDay,
      hexKey,
      minutes,
      mph,
      note: clockNote,
      clockFrom: clockResult.ok && clockResult.advanced
        ? (clockResult.clockBefore ?? clockBefore)
        : clockBefore,
      clockTo:
        clockResult.ok && clockResult.advanced ? clockResult.clockAfter : undefined,
    });
  }

  const encounterRolls = travelEncounterRollCount(
    state.travelEventMode,
    hoursBefore,
    next.hoursTraveledToday,
    { onHexEntry },
  );
  next = await appendTravelEncounters(next, hexKey, encounterRolls);
  return applyPendingDayEndIfNeeded(next);
}

export async function processTravelHexEntry(params: {
  sceneId: string;
  tokenId: string;
  hexKey: string;
}): Promise<void> {
  return enqueueTravelHexEntry(params.sceneId, () => processTravelHexEntryInner(params));
}

async function processTravelHexEntryInner(params: {
  sceneId: string;
  tokenId: string;
  hexKey: string;
}): Promise<void> {
  if (!currentUserIsOverseer()) return;

  let state = loadHexcrawlSceneState(params.sceneId);
  if (!state?.enabled || state.arrived) return;
  if (resetTravelActiveScenes.has(params.sceneId) || state.resetTravelPending) return;

  const travelTokenId = resolveTravelTokenId(params.sceneId, state);
  if (!tokenQualifiesForHexEntry(params.sceneId, state, params.tokenId)) return;

  if (travelTokenId && travelTokenId !== state.travelTokenId) {
    state = { ...state, travelTokenId };
  }
  if (state.lastHexKey === params.hexKey) return;

  const hexTerrain = resolveTerrainForHex(state, params.hexKey);
  const mph = resolvePartyTravelMph(
    filterHexcrawlTravelRoleActorIds(state.partyActorIds),
    hexTerrain,
  );
  const milesPerHex = getSceneMilesPerHex(params.sceneId);
  const minutes = hexTravelMinutes(milesPerHex, mph);
  const clockBefore = getWorldClockLabel();

  state = appendJourneyLog(state, {
    kind: "hexEntered",
    travelDay: state.travelDay,
    hexKey: params.hexKey,
    clockAt: clockBefore,
    note: hexTerrain,
  });
  state = {
    ...state,
    lastHexKey: params.hexKey,
    trailCleared: false,
    traveledHexKeys: appendTraveledHexKey(state.traveledHexKeys, params.hexKey),
    milesTraveledCumulative: state.milesTraveledCumulative + milesPerHex,
  };
  const poiDiscovery = discoverPoiOnHexEntry(state, params.hexKey);
  state = poiDiscovery.state;
  if (poiDiscovery.discovered) {
    const { notifyPoiDiscovered } = await import("./poiDiscoveryChat.js");
    notifyPoiDiscovered(poiDiscovery.discovered);
  }

  state = await applyTravelMinutes({
    state,
    sceneId: params.sceneId,
    hexKey: params.hexKey,
    minutes,
    mph,
    onHexEntry: true,
  });

  const saved = await saveHexcrawlSceneState(state, { writeHexMap: false });
  const overlayState = saved ?? loadHexcrawlSceneState(params.sceneId);
  if (overlayState) {
    await refreshHexcrawlMapOverlay(params.sceneId, overlayState);
  }
  const { default: HexcrawlTravelApp } = await import("./HexcrawlTravelApp.js");
  HexcrawlTravelApp.rebindForScene(params.sceneId, { force: true });
}

export async function ensureHexGridForScene(sceneId: string): Promise<void> {
  const scene = game.scenes.get(sceneId);
  if (!scene) return;

  const grid = scene.grid as {
    type?: number;
    distance?: number;
    units?: string;
    alpha?: number;
  };

  const HEX_ODD =
    (globalThis as { CONST?: { GRID_TYPES?: { HEXODDR: number } } }).CONST
      ?.GRID_TYPES?.HEXODDR ?? 3;

  const needsHex = grid.type !== HEX_ODD && grid.type !== 4;
  const distance =
    typeof grid.distance === "number" && grid.distance > 0
      ? grid.distance
      : getSceneMilesPerHex(sceneId);
  const units = grid.units?.trim() || "mi";

  if (!needsHex) return;

  const proceed = await scavengerConfirmDialog(
    t("WASTELANDER.Hexcrawl.Grid.ConfirmTitle"),
    t("WASTELANDER.Hexcrawl.Grid.ConfirmBody"),
  );
  if (!proceed) return;

  await scene.update({
    grid: {
      type: HEX_ODD,
      distance,
      units,
      alpha: 0.35,
    },
  });
}

export function applyCourseCheckPass(state: HexcrawlSceneState): HexcrawlSceneState {
  let next = appendJourneyLog(state, {
    kind: "courseCheck",
    travelDay: state.travelDay,
    passed: true,
    difficulty: state.currentDifficulty,
    courseStatus: "onCourse",
  });
  next = {
    ...next,
    courseStatus: "onCourse",
    currentDifficulty: next.baseDifficulty,
    courseCheckResolved: true,
  };
  return next;
}

export function applyCourseCheckFail(state: HexcrawlSceneState): HexcrawlSceneState {
  const newDifficulty = clampDifficulty(state.currentDifficulty + 1);
  let next = appendJourneyLog(state, {
    kind: "courseCheck",
    travelDay: state.travelDay,
    passed: false,
    difficulty: newDifficulty,
    courseStatus: "lost",
  });
  return {
    ...next,
    courseStatus: "lost",
    currentDifficulty: newDifficulty,
  };
}

/** Pass enabled when lost, or when day end is pending and pass not yet resolved for this cycle. */
export function courseChecksEnabled(state: HexcrawlSceneState): boolean {
  if (state.courseStatus === "lost") return true;
  return (
    state.pendingDayEnd &&
    !(state.courseCheckResolved && state.courseStatus === "onCourse")
  );
}

/** Course check fail is always available while hexcrawl is enabled. */
export function courseFailEnabled(state: HexcrawlSceneState): boolean {
  return state.enabled;
}

/** Confirm day end only after a successful pass while still on course for this cycle. */
export function confirmDayEndEnabled(state: HexcrawlSceneState): boolean {
  return (
    state.pendingDayEnd &&
    state.courseCheckResolved &&
    state.courseStatus === "onCourse"
  );
}

/** Adds one hex of travel time (hours + world clock) without changing position. */
export async function applyOneHexTravelTime(
  state: HexcrawlSceneState,
  sceneId: string,
): Promise<HexcrawlSceneState> {
  const hexKey = state.lastHexKey ?? "";
  const hexTerrain = resolveTerrainForHex(state, hexKey);
  const mph = resolvePartyTravelMph(
    filterHexcrawlTravelRoleActorIds(state.partyActorIds),
    hexTerrain,
  );
  const milesPerHex = getSceneMilesPerHex(sceneId);
  const minutes = hexTravelMinutes(milesPerHex, mph);

  return applyTravelMinutes({
    state,
    sceneId,
    hexKey: hexKey || undefined,
    minutes,
    mph,
    clockNote: "courseCheck",
    onHexEntry: false,
  });
}

export function validateLostTravelMove(
  sceneId: string,
  doc: TokenDocForHex,
  movement: TokenMovementLike,
): { allowed: boolean; reason?: "lost" } {
  const state = loadHexcrawlSceneState(sceneId);
  if (state?.courseStatus !== "lost") return { allowed: true };
  if (!shouldConstrainTravelTokenMove(sceneId, doc.id)) return { allowed: true };

  const originHex = movement.origin
    ? getHexKeyFromTokenDocument(doc, movement.origin)
    : getHexKeyFromTokenDocument(doc);
  const destHex = movement.destination
    ? getHexKeyFromTokenDocument(doc, movement.destination)
    : null;

  if (originHex && destHex && originHex !== destHex) {
    return { allowed: false, reason: "lost" };
  }

  return { allowed: true };
}

export function confirmTravelDayEnd(state: HexcrawlSceneState): HexcrawlSceneState {
  return {
    ...state,
    pendingDayEnd: false,
    courseCheckResolved: false,
    hoursTraveledToday: 0,
    travelDay: state.travelDay + 1,
  };
}

export function applySetCampDayEnd(state: HexcrawlSceneState): HexcrawlSceneState {
  const hoursEnded = state.hoursTraveledToday;
  let next = appendJourneyLog(state, {
    kind: "dayEnded",
    travelDay: state.travelDay,
    hexKey: state.lastHexKey ?? undefined,
    note: String(hoursEnded),
  });
  next = appendJourneyLog(next, {
    kind: "campSet",
    travelDay: state.travelDay + 1,
    hexKey: state.lastHexKey ?? undefined,
  });
  return resetMilesTraveledCumulative({
    ...next,
    pendingDayEnd: false,
    courseCheckResolved: false,
    hoursTraveledToday: 0,
    travelDay: state.travelDay + 1,
  });
}

export async function processSetCamp(
  sceneId: string,
  state: HexcrawlSceneState,
): Promise<HexcrawlSceneState> {
  if (!currentUserIsOverseer()) return state;
  if (!state.enabled) return state;

  const encounter = await rollHexcrawlCampEncounter();
  let next = appendJourneyLog(state, {
    kind: "campEncounter",
    travelDay: state.travelDay,
    hexKey: state.lastHexKey ?? undefined,
    encounterType: encounter.encounterType,
    encounterName: encounter.encounterName,
    encounterDescription: encounter.encounterDescription,
    cdFaces: encounter.cdFaces,
    cdEffects: encounter.cdEffects,
    note: encounter.error,
  });
  next = applySetCampDayEnd(next);
  await saveHexcrawlSceneState(next, { writeHexMap: false });
  ui.notifications.info(
    t("WASTELANDER.Hexcrawl.Notify.CampSet", { day: next.travelDay }),
  );
  return next;
}

export function buildInitialPartyActorIds(sceneId: string): string[] {
  return getPartyActorsOnScene(sceneId).map((row) => row.actorId);
}

type SceneTokenDoc = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  getOccupiedGridSpaceOffsets?: (
    data?: Partial<{ x: number; y: number; width: number; height: number }>,
  ) => Array<{ i: number; j: number }>;
  getSize?: (data?: Partial<{ width: number; height: number }>) => {
    width: number;
    height: number;
  };
  update?: (data: { x: number; y: number }) => Promise<unknown>;
};

type SceneWithTokens = {
  tokens?: {
    get: (id: string) => SceneTokenDoc | undefined;
  };
};

export function resolveCurrentTravelHexKey(
  sceneId: string,
  state: Pick<HexcrawlSceneState, "travelTokenId" | "navigatorActorId">,
): string | null {
  const scene = (game as { scenes?: { get: (id: string) => SceneWithTokens | undefined } })
    .scenes?.get(sceneId);
  if (!scene?.tokens) return null;

  let tokenId = state.travelTokenId;
  if (!tokenId && state.navigatorActorId) {
    tokenId = findSceneTokenIdForActor(sceneId, state.navigatorActorId);
  }
  if (!tokenId) return null;

  const tokenDoc = scene.tokens.get(tokenId);
  if (!tokenDoc) return null;
  return getHexKeyFromTokenDocument(tokenDoc);
}

export function applySetStartingHex(
  state: HexcrawlSceneState,
  hexKey: string,
): HexcrawlSceneState {
  const fog = applyHexEntryFogEffects(
    {
      ...state,
      startingHexKey: hexKey,
      lastHexKey: hexKey,
      trailCleared: false,
      traveledHexKeys: [hexKey],
    },
    hexKey,
  );
  if (fog.discovered) {
    void import("./poiDiscoveryChat.js").then(({ notifyPoiDiscovered }) =>
      notifyPoiDiscovered(fog.discovered!),
    );
  }
  return appendJourneyLog(fog.state, {
    kind: "startingLocationSet",
    travelDay: state.travelDay,
    hexKey,
  });
}

export function applyResetTravel(
  state: HexcrawlSceneState,
  resetTokenId: string,
): HexcrawlSceneState {
  const condition = navigationConditionById(state.navigationConditionId);
  const baseDifficulty = condition?.baseDifficulty ?? state.baseDifficulty;
  const startingHexKey = state.startingHexKey;
  return appendJourneyLog(
    {
      ...state,
      hoursTraveledToday: 0,
      travelDay: 1,
      lastHexKey: startingHexKey,
      arrived: false,
      pendingDayEnd: false,
      courseCheckResolved: false,
      courseStatus: "onCourse",
      baseDifficulty,
      currentDifficulty: baseDifficulty,
      resetTravelPending: startingHexKey
        ? { tokenId: resetTokenId, untilHexKey: startingHexKey }
        : null,
      traveledHexKeys: startingHexKey ? [startingHexKey] : [],
      trailCleared: false,
    },
    {
      kind: "travelReset",
      travelDay: 1,
      hexKey: startingHexKey ?? undefined,
      note: startingHexKey ?? "",
    },
  );
}

export function resolveNavigatorTokenId(
  sceneId: string,
  state: Pick<HexcrawlSceneState, "navigatorActorId" | "travelTokenId">,
): string | null {
  return resolveTravelTokenId(sceneId, state);
}

export async function moveTokenToHexKey(
  sceneId: string,
  tokenId: string,
  hexKey: string,
  position?: { x: number; y: number },
): Promise<boolean> {
  const scene = (game as { scenes?: { get: (id: string) => SceneWithTokens | undefined } })
    .scenes?.get(sceneId);
  const tokenDoc = scene?.tokens?.get(tokenId);
  if (!tokenDoc?.update) return false;

  const snap =
    position ?? tokenPositionForHexKeyOnScene(sceneId, hexKey);
  if (!snap) return false;

  await tokenDoc.update(snap);
  return true;
}

export async function confirmAndResetTravel(
  sceneId: string,
  state: HexcrawlSceneState,
): Promise<HexcrawlSceneState | null> {
  if (!state.startingHexKey) {
    ui.notifications.warn(t("WASTELANDER.Hexcrawl.Notify.NoStartingHex"));
    return null;
  }

  const proceed = await scavengerConfirmDialog(
    t("WASTELANDER.Hexcrawl.Reset.ConfirmTitle"),
    t("WASTELANDER.Hexcrawl.Reset.ConfirmBody", {
      hex: state.startingHexKey,
    }),
  );
  if (!proceed) return null;

  const tokenId = resolveNavigatorTokenId(sceneId, state);
  if (!tokenId) {
    ui.notifications.warn(t("WASTELANDER.Hexcrawl.Notify.NoNavigatorToken"));
    return null;
  }

  markResetTravelActive(sceneId);
  try {
    const resetState = applyResetTravel(state, tokenId);
    const saved = await saveHexcrawlSceneState(resetState, { writeHexMap: false });
    const persisted = saved ?? resetState;

    const moved = await moveTokenToHexKey(sceneId, tokenId, state.startingHexKey);
    if (!moved) {
      await clearResetTravelPending(sceneId);
      ui.notifications.warn(t("WASTELANDER.Hexcrawl.Notify.ResetMoveFailed"));
      return persisted;
    }

    await finishResetTravelIfArrived(sceneId, tokenId);
    await refreshHexcrawlMapOverlay(sceneId, persisted);

    ui.notifications.info(t("WASTELANDER.Hexcrawl.Notify.ResetComplete"));
    return persisted;
  } catch (error) {
    await clearResetTravelPending(sceneId);
    throw error;
  }
}
