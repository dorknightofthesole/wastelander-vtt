import { MODULE_ID } from "../constants.js";
import { getSceneDocument } from "../scavenging/scenePersist.js";
import {
  type CourseStatus,
  navigationConditionById,
  NAVIGATION_CONDITIONS,
  normalizeTravelEventMode,
  normalizeTravelTerrainType,
  type TravelEventMode,
  type TravelTerrainType,
} from "./travelRules.js";
import {
  hexHasCover,
  hexHasDiscoverablePoi,
  mergeDiscoveredPoiHexKeys,
  normalizeDiscoveredPoiHexKeys,
  normalizeHexAnnotations,
  normalizeHiddenTrailHexKeys,
  normalizeRevealedHexCoverKeys,
  setHexCover,
  type HexAnnotation,
} from "./hexAnnotations.js";
import { scheduleHexcrawlJournalSync } from "./hexcrawlJournalSync.js";
import { clearStagedHexcrawlMapOverlayState, stageHexcrawlMapOverlayState } from "./hexMapOverlayState.js";
import { debugHexCover } from "./hexCoverDebug.js";
import { getWorldClockLabel } from "../integrations/worldClock.js";

export type { HexAnnotation };

export const HEXCRAWL_SCENE_STATE_FLAG = "hexcrawlSceneState";
/** Per-hex map edits — separate flag so cleared icons/terrain are not resurrected by Foundry flag merge. */
export const HEXCRAWL_HEX_MAP_FLAG = "hexcrawlHexMap";
export const HEXCRAWL_JOURNAL_PAGE_FLAG = "hexcrawlJournalPageId";

export type HexcrawlHexMapFlag = {
  hexAnnotations: Record<string, HexAnnotation>;
  hiddenTrailHexKeys: string[];
  showTerrainIcons: boolean;
  updatedAt: number;
};

function hexMapFlagFromState(
  state: Pick<
    HexcrawlSceneState,
    "hexAnnotations" | "hiddenTrailHexKeys" | "showTerrainIcons" | "updatedAt"
  >,
): HexcrawlHexMapFlag {
  return {
    hexAnnotations: { ...state.hexAnnotations },
    hiddenTrailHexKeys: [...state.hiddenTrailHexKeys],
    showTerrainIcons: state.showTerrainIcons !== false,
    updatedAt: state.updatedAt,
  };
}

function applyHexMapFlag(
  state: HexcrawlSceneState,
  raw: unknown,
  rawRow?: Record<string, unknown>,
): HexcrawlSceneState {
  if (!raw || typeof raw !== "object") return state;
  const row = raw as Partial<HexcrawlHexMapFlag>;

  let annotations = normalizeHexAnnotations(row.hexAnnotations);
  if (rawRow && "revealedHexCoverKeys" in rawRow) {
    for (const hexKey of normalizeRevealedHexCoverKeys(rawRow.revealedHexCoverKeys)) {
      if (!annotations[hexKey]?.hexCoverColor) continue;
      annotations = setHexCover({ ...state, hexAnnotations: annotations }, hexKey, null).hexAnnotations;
    }
  }

  return {
    ...state,
    hexAnnotations: annotations,
    hiddenTrailHexKeys: normalizeHiddenTrailHexKeys(row.hiddenTrailHexKeys),
    showTerrainIcons: row.showTerrainIcons !== false,
  };
}
/** Orphan from an abandoned cross-scene experiment — cleared when saving v1 scene state. */
const HEXCRAWL_JOURNEY_STATE_FLAG = "hexcrawlJourneyState";

export type JourneyLogKind =
  | "enabled"
  | "disabled"
  | "hexEntered"
  | "clockAdvanced"
  | "encounter"
  | "dayEnded"
  | "campEncounter"
  | "campSet"
  | "courseCheck"
  | "courseStatus"
  | "arrival"
  | "startingLocationSet"
  | "travelReset"
  | "sceneCrossed";

export type SceneCardinal = "north" | "south" | "east" | "west";

/** Optional one-way links to adjacent overworld scenes by cardinal direction. */
export type SceneLinks = Partial<Record<SceneCardinal, string>>;

export type JourneyLogEntry = {
  at: number;
  kind: JourneyLogKind;
  travelDay: number;
  hexKey?: string;
  minutes?: number;
  mph?: number;
  encounterType?: string;
  encounterName?: string;
  encounterDescription?: string;
  cdFaces?: number[];
  cdEffects?: number;
  passed?: boolean;
  courseStatus?: CourseStatus;
  difficulty?: number;
  note?: string;
  /** In-game date/time when the event occurred (Simple Calendar). */
  clockAt?: string;
  /** In-game date/time at the start of a travel interval. */
  clockFrom?: string;
  /** In-game date/time at the end of a travel interval. */
  clockTo?: string;
};

export type HexcrawlSceneState = {
  version: 1;
  sceneId: string;
  enabled: boolean;
  travelEventMode: TravelEventMode;
  /** GM Toolkit p.9 terrain column for party travel speed. */
  terrainType: TravelTerrainType;
  travelTokenId: string | null;
  partyActorIds: string[];
  navigatorActorId: string | null;
  navigationConditionId: string;
  baseDifficulty: number;
  currentDifficulty: number;
  courseStatus: CourseStatus;
  maxHoursPerDay: number;
  hoursTraveledToday: number;
  travelDay: number;
  lastHexKey: string | null;
  startingHexKey: string | null;
  /** Suppresses clock/encounter processing while a reset token move is in flight. */
  resetTravelPending: { tokenId: string; untilHexKey: string } | null;
  arrived: boolean;
  pendingDayEnd: boolean;
  /** True after Pass/Fail is chosen for the current pending day end. */
  courseCheckResolved: boolean;
  journeyLog: JourneyLogEntry[];
  /** Hex keys outlined on the map travel trail (border overlay). */
  traveledHexKeys: string[];
  /** CSS hex color for the map travel trail overlay (e.g. #863e0e). */
  trailOverlayColor: string;
  /** True after journal clear until the next trail update (hex entry, set starting, reset). */
  trailCleared: boolean;
  sceneLinks: SceneLinks;
  /** Per-hex terrain overrides and POI icon ids. */
  hexAnnotations: Record<string, HexAnnotation>;
  /** Trail outline hidden for these hex keys (journey log unchanged). */
  hiddenTrailHexKeys: string[];
  /** Draw terrain badge icons on annotated hexes (Map overlay). */
  showTerrainIcons: boolean;
  /** Hex keys whose POI icons are visible to players (overseers always see all). */
  discoveredPoiHexKeys: string[];
  /** Miles traveled since last camp or arrival. */
  milesTraveledCumulative: number;
  updatedAt: number;
};

export const DEFAULT_TRAIL_OVERLAY_COLOR = "#863e0e";

export function defaultHexcrawlState(sceneId: string): HexcrawlSceneState {
  const condition = NAVIGATION_CONDITIONS[0];
  return {
    version: 1,
    sceneId,
    enabled: false,
    travelEventMode: "hexEntry",
    terrainType: "normal",
    travelTokenId: null,
    partyActorIds: [],
    navigatorActorId: null,
    navigationConditionId: condition?.id ?? "clear-trail",
    baseDifficulty: condition?.baseDifficulty ?? 1,
    currentDifficulty: condition?.baseDifficulty ?? 1,
    courseStatus: "onCourse",
    maxHoursPerDay: 8,
    hoursTraveledToday: 0,
    travelDay: 1,
    lastHexKey: null,
    startingHexKey: null,
    resetTravelPending: null,
    arrived: false,
    pendingDayEnd: false,
    courseCheckResolved: false,
    journeyLog: [],
    traveledHexKeys: [],
    trailOverlayColor: DEFAULT_TRAIL_OVERLAY_COLOR,
    trailCleared: false,
    sceneLinks: {},
    hexAnnotations: {},
    hiddenTrailHexKeys: [],
    showTerrainIcons: true,
    discoveredPoiHexKeys: [],
    milesTraveledCumulative: 0,
    updatedAt: Date.now(),
  };
}

const SCENE_CARDINALS: SceneCardinal[] = ["north", "south", "east", "west"];

function normalizeSceneLinks(raw: unknown): SceneLinks {
  if (!raw || typeof raw !== "object") return {};
  const row = raw as Record<string, unknown>;
  const links: SceneLinks = {};
  for (const direction of SCENE_CARDINALS) {
    const value = row[direction];
    if (typeof value === "string" && value.length > 0) {
      links[direction] = value;
    }
  }
  return links;
}

function normalizeTrailOverlayColor(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_TRAIL_OVERLAY_COLOR;
  const trimmed = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  return DEFAULT_TRAIL_OVERLAY_COLOR;
}

function normalizeTraveledHexKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((key): key is string => typeof key === "string" && key.length > 0);
}

function normalizeJourneyLog(raw: unknown): JourneyLogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((row) => row && typeof row === "object") as JourneyLogEntry[];
}

function normalizeResetTravelPending(
  raw: unknown,
): HexcrawlSceneState["resetTravelPending"] {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as { tokenId?: unknown; untilHexKey?: unknown };
  if (typeof data.tokenId !== "string" || typeof data.untilHexKey !== "string") {
    return null;
  }
  return { tokenId: data.tokenId, untilHexKey: data.untilHexKey };
}

function loadLegacyWorldJourney(): Record<string, unknown> | null {
  const raw = (game as { world?: { getFlag?: (scope: string, key: string) => unknown } })
    .world?.getFlag?.(MODULE_ID, HEXCRAWL_JOURNEY_STATE_FLAG);
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

function shouldMergeWorldJourney(
  sceneId: string,
  data: Record<string, unknown>,
): boolean {
  if (data.version === 2) return true;
  const journey = loadLegacyWorldJourney();
  if (!journey) return false;
  const activeSceneId =
    typeof journey.activeSceneId === "string" ? journey.activeSceneId : null;
  if (activeSceneId && activeSceneId !== sceneId) return false;
  const hasLocalParty =
    Array.isArray(data.partyActorIds) && data.partyActorIds.length > 0;
  const hasLocalHours =
    typeof data.hoursTraveledToday === "number" && data.hoursTraveledToday > 0;
  const hasLocalLog =
    Array.isArray(data.journeyLog) && data.journeyLog.length > 0;
  return !hasLocalParty && !hasLocalHours && !hasLocalLog;
}

function coalesceSplitPayload(
  raw: Record<string, unknown>,
  sceneId: string,
): Record<string, unknown> {
  const journey = loadLegacyWorldJourney() ?? {};
  return { ...journey, ...raw, version: 1, sceneId };
}

/**
 * Pick the travel-progress snapshot that is ahead (hooks, camp, reset vs stale UI).
 */
function pickLeadingTravelProgress(
  pending: HexcrawlSceneState,
  fresh: HexcrawlSceneState,
): HexcrawlSceneState {
  const freshIsAhead =
    fresh.journeyLog.length > pending.journeyLog.length ||
    fresh.travelDay > pending.travelDay ||
    fresh.traveledHexKeys.length > pending.traveledHexKeys.length;

  const pendingIsAhead =
    pending.journeyLog.length > fresh.journeyLog.length ||
    (pending.travelDay === fresh.travelDay &&
      pending.hoursTraveledToday > fresh.hoursTraveledToday + 0.001) ||
    pending.traveledHexKeys.length > fresh.traveledHexKeys.length;

  if (freshIsAhead && !pendingIsAhead) return fresh;
  if (pendingIsAhead && !freshIsAhead) return pending;
  if (freshIsAhead) return fresh;
  return pending;
}

/**
 * Before persisting UI edits, re-read the scene flag and keep travel-hook progress
 * so dropdown/close saves cannot zero hours or drop journal entries.
 */
export function prepareHexcrawlStateForSave(
  pending: HexcrawlSceneState,
  sceneId: string,
  options?: { preferFreshHexMap?: boolean },
): HexcrawlSceneState {
  const fresh = loadHexcrawlSceneState(sceneId);
  if (!fresh) return pending;

  const progressBase = pickLeadingTravelProgress(pending, fresh);
  const preferFreshHexMap = options?.preferFreshHexMap === true;

  const merged: HexcrawlSceneState = {
    ...progressBase,
    enabled: pending.enabled,
    travelEventMode: pending.travelEventMode,
    terrainType: pending.terrainType,
    partyActorIds: pending.partyActorIds,
    navigatorActorId: pending.navigatorActorId,
    navigationConditionId: pending.navigationConditionId,
    baseDifficulty: pending.baseDifficulty,
    currentDifficulty: pending.currentDifficulty,
    courseStatus: pending.courseStatus,
    maxHoursPerDay: pending.maxHoursPerDay,
    arrived: pending.arrived,
    pendingDayEnd: pending.pendingDayEnd,
    courseCheckResolved: pending.courseCheckResolved,
    trailOverlayColor: pending.trailOverlayColor,
    startingHexKey: pending.startingHexKey ?? fresh.startingHexKey,
    sceneLinks: pending.sceneLinks,
    hexAnnotations: preferFreshHexMap ? fresh.hexAnnotations : pending.hexAnnotations,
    hiddenTrailHexKeys: preferFreshHexMap
      ? fresh.hiddenTrailHexKeys
      : pending.hiddenTrailHexKeys,
    showTerrainIcons: preferFreshHexMap ? fresh.showTerrainIcons : pending.showTerrainIcons,
    discoveredPoiHexKeys: mergeDiscoveredPoiHexKeys(
      pending.discoveredPoiHexKeys,
      fresh.discoveredPoiHexKeys,
    ),
  };

  if (pending.trailCleared && pending.journeyLog.length === 0) {
    return {
      ...merged,
      journeyLog: [],
      traveledHexKeys: [],
      trailCleared: true,
      travelDay: pending.travelDay,
      hoursTraveledToday: pending.hoursTraveledToday,
      lastHexKey: pending.lastHexKey,
    };
  }

  return merged;
}

export function normalizeHexcrawlState(
  raw: unknown,
  sceneId: string,
): HexcrawlSceneState {
  const base = defaultHexcrawlState(sceneId);
  if (!raw || typeof raw !== "object") return base;

  let data = raw as Record<string, unknown>;
  if (shouldMergeWorldJourney(sceneId, data)) {
    data = coalesceSplitPayload(data, sceneId);
  }

  const row = data as Partial<HexcrawlSceneState>;
  const navigationConditionId =
    typeof row.navigationConditionId === "string"
      ? row.navigationConditionId
      : base.navigationConditionId;
  const condition = navigationConditionById(navigationConditionId);
  const baseDifficulty =
    typeof row.baseDifficulty === "number"
      ? row.baseDifficulty
      : (condition?.baseDifficulty ?? base.baseDifficulty);

  return {
    ...base,
    enabled: Boolean(row.enabled),
    travelEventMode: normalizeTravelEventMode(row.travelEventMode),
    terrainType: normalizeTravelTerrainType(row.terrainType),
    travelTokenId:
      typeof row.travelTokenId === "string" ? row.travelTokenId : null,
    partyActorIds: Array.isArray(row.partyActorIds)
      ? row.partyActorIds.filter((id) => typeof id === "string")
      : [],
    navigatorActorId:
      typeof row.navigatorActorId === "string" ? row.navigatorActorId : null,
    navigationConditionId,
    baseDifficulty,
    currentDifficulty:
      typeof row.currentDifficulty === "number"
        ? row.currentDifficulty
        : baseDifficulty,
    courseStatus: row.courseStatus === "lost" ? "lost" : "onCourse",
    maxHoursPerDay:
      typeof row.maxHoursPerDay === "number" && row.maxHoursPerDay > 0
        ? Math.min(12, Math.floor(row.maxHoursPerDay))
        : base.maxHoursPerDay,
    hoursTraveledToday:
      typeof row.hoursTraveledToday === "number"
        ? Math.max(0, row.hoursTraveledToday)
        : 0,
    travelDay:
      typeof row.travelDay === "number" && row.travelDay >= 1
        ? Math.floor(row.travelDay)
        : 1,
    lastHexKey: typeof row.lastHexKey === "string" ? row.lastHexKey : null,
    startingHexKey:
      typeof row.startingHexKey === "string" ? row.startingHexKey : null,
    resetTravelPending: normalizeResetTravelPending(row.resetTravelPending),
    arrived: Boolean(row.arrived),
    pendingDayEnd: Boolean(row.pendingDayEnd),
    courseCheckResolved: Boolean(row.courseCheckResolved),
    journeyLog: normalizeJourneyLog(row.journeyLog),
    traveledHexKeys: normalizeTraveledHexKeys(row.traveledHexKeys),
    trailOverlayColor: normalizeTrailOverlayColor(row.trailOverlayColor),
    trailCleared: Boolean(row.trailCleared),
    sceneLinks: normalizeSceneLinks(row.sceneLinks),
    hexAnnotations: normalizeHexAnnotations(row.hexAnnotations),
    hiddenTrailHexKeys: normalizeHiddenTrailHexKeys(row.hiddenTrailHexKeys),
    showTerrainIcons: row.showTerrainIcons !== false,
    discoveredPoiHexKeys: normalizeDiscoveredPoiHexKeys(row.discoveredPoiHexKeys),
    milesTraveledCumulative:
      typeof row.milesTraveledCumulative === "number"
        ? Math.max(0, row.milesTraveledCumulative)
        : 0,
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : Date.now(),
  };
}

/** Unique trail hex keys in draw order; includes starting hex when missing from persisted trail. */
export function resolveTrailHexKeys(
  state: Pick<HexcrawlSceneState, "traveledHexKeys" | "startingHexKey" | "trailCleared">,
): string[] {
  if (state.trailCleared && state.traveledHexKeys.length === 0) return [];

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const hexKey of state.traveledHexKeys) {
    if (seen.has(hexKey)) continue;
    seen.add(hexKey);
    keys.push(hexKey);
  }

  if (keys.length === 0 && state.startingHexKey) {
    return [state.startingHexKey];
  }

  if (state.startingHexKey && !seen.has(state.startingHexKey)) {
    keys.unshift(state.startingHexKey);
  }
  return keys;
}

export function ensureStartingHexInTrail(state: HexcrawlSceneState): HexcrawlSceneState {
  if (!state.startingHexKey) return state;
  return {
    ...state,
    trailCleared: false,
    traveledHexKeys: appendTraveledHexKey(state.traveledHexKeys, state.startingHexKey),
  };
}

export function resetMilesTraveledCumulative(state: HexcrawlSceneState): HexcrawlSceneState {
  return { ...state, milesTraveledCumulative: 0 };
}

export function appendTraveledHexKey(keys: string[], hexKey: string): string[] {
  if (keys.includes(hexKey)) return keys;
  return [...keys, hexKey];
}

function backfillDiscoveredPoisFromTravel(state: HexcrawlSceneState): HexcrawlSceneState {
  const discovered = normalizeDiscoveredPoiHexKeys(
    resolveTrailHexKeys(state).filter((hexKey) => hexHasDiscoverablePoi(state, hexKey)),
  );
  return { ...state, discoveredPoiHexKeys: discovered };
}

function coverHexKeys(annotations: Record<string, HexAnnotation>): string[] {
  return Object.entries(annotations)
    .filter(([, row]) => row?.hexCoverColor)
    .map(([key]) => key);
}

type SceneFlagWriter = {
  getFlag?: (scope: string, key: string) => unknown;
  setFlag: (
    scope: string,
    key: string,
    value: unknown,
    options?: { merge?: boolean },
  ) => Promise<unknown>;
  unsetFlag?: (scope: string, key: string) => Promise<unknown>;
  update?: (data: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Foundry merges flag objects instead of replacing them — deleted nested keys survive
 * setFlag even with merge:false. Unset the flag first, then write the full value.
 */
async function replaceSceneModuleFlag(
  sceneId: string,
  key: string,
  value: unknown,
): Promise<boolean> {
  const scene = getSceneDocument(sceneId) as SceneFlagWriter | undefined;
  if (!scene?.setFlag) return false;
  if (scene.unsetFlag) {
    await scene.unsetFlag(MODULE_ID, key);
  }
  await scene.setFlag(MODULE_ID, key, value, { merge: false });
  return true;
}

async function stripMainFlagHexAnnotations(sceneId: string): Promise<void> {
  const scene = getSceneDocument(sceneId) as SceneFlagWriter | undefined;
  if (!scene?.getFlag) return;

  const raw = scene.getFlag(MODULE_ID, HEXCRAWL_SCENE_STATE_FLAG);
  if (!raw || typeof raw !== "object") return;

  const row = raw as Record<string, unknown>;
  const embedded = row.hexAnnotations;
  const hasEmbedded =
    embedded &&
    typeof embedded === "object" &&
    Object.keys(embedded as object).length > 0;
  const hasHidden =
    Array.isArray(row.hiddenTrailHexKeys) && row.hiddenTrailHexKeys.length > 0;
  if (!hasEmbedded && !hasHidden) return;

  const flagRoot = `flags.${MODULE_ID}.${HEXCRAWL_SCENE_STATE_FLAG}`;
  if (scene.update) {
    await scene.update({
      [`${flagRoot}.-hexAnnotations`]: null,
      [`${flagRoot}.-hiddenTrailHexKeys`]: null,
    });
  } else {
    const duplicate = foundry.utils.duplicate(raw) as Record<string, unknown>;
    delete duplicate.hexAnnotations;
    delete duplicate.hiddenTrailHexKeys;
    await replaceSceneModuleFlag(sceneId, HEXCRAWL_SCENE_STATE_FLAG, duplicate);
  }
  debugHexCover("stripMainFlagHexAnnotations: cleared embedded map fields from main flag", {
    sceneId,
  });
}

function readHexMapFlagRaw(sceneId: string): HexcrawlHexMapFlag | null {
  const scene = getSceneDocument(sceneId);
  if (!scene?.getFlag) return null;
  const raw = scene.getFlag(MODULE_ID, HEXCRAWL_HEX_MAP_FLAG);
  if (!raw || typeof raw !== "object") return null;
  return raw as HexcrawlHexMapFlag;
}

export function loadHexcrawlSceneState(sceneId: string): HexcrawlSceneState | null {
  const scene = getSceneDocument(sceneId);
  if (!scene) return null;
  const raw = scene.getFlag(MODULE_ID, HEXCRAWL_SCENE_STATE_FLAG);
  if (!raw) return null;
  const rawRow = raw as Record<string, unknown>;
  let state = normalizeHexcrawlState(raw, sceneId);
  const hexMapRaw = scene.getFlag(MODULE_ID, HEXCRAWL_HEX_MAP_FLAG);
  if (hexMapRaw) {
    // Map data lives only in hexcrawlHexMap — ignore stale copies embedded in the main flag.
    state = applyHexMapFlag(
      { ...state, hexAnnotations: {}, hiddenTrailHexKeys: [] },
      hexMapRaw,
      rawRow,
    );
  }
  if (!("discoveredPoiHexKeys" in rawRow)) {
    state = backfillDiscoveredPoisFromTravel(state);
  }
  return state;
}

export type SaveHexcrawlSceneStateOptions = {
  /** When false, travel/progress saves leave hexcrawlHexMap unchanged (default true). */
  writeHexMap?: boolean;
};

export async function persistHexMapFlag(
  sceneId: string,
  map: Pick<HexcrawlHexMapFlag, "hexAnnotations" | "hiddenTrailHexKeys" | "showTerrainIcons">,
): Promise<boolean> {
  const payload: HexcrawlHexMapFlag = {
    hexAnnotations: structuredClone(map.hexAnnotations),
    hiddenTrailHexKeys: [...map.hiddenTrailHexKeys],
    showTerrainIcons: map.showTerrainIcons !== false,
    updatedAt: Date.now(),
  };
  const persisted = await replaceSceneModuleFlag(sceneId, HEXCRAWL_HEX_MAP_FLAG, payload);
  if (!persisted) {
    debugHexCover("persistHexMapFlag: failed — scene missing or cannot setFlag", { sceneId });
    return false;
  }
  await stripMainFlagHexAnnotations(sceneId);

  const readback = readHexMapFlagRaw(sceneId);
  debugHexCover("persistHexMapFlag: saved", {
    sceneId,
    hexAnnotationKeys: Object.keys(payload.hexAnnotations),
    coverHexKeysWritten: coverHexKeys(payload.hexAnnotations),
    coverHexKeysReadback: readback
      ? coverHexKeys(normalizeHexAnnotations(readback.hexAnnotations))
      : null,
    updatedAt: payload.updatedAt,
  });
  return true;
}

/** Delete hex hide covers for one or more keys in a single hex map write. */
export async function removeHexCoversOnEntry(
  sceneId: string,
  hexKeys: string[],
): Promise<boolean> {
  const state = loadHexcrawlSceneState(sceneId);
  if (!state) {
    debugHexCover("removeHexCoversOnEntry: skip — no scene state", { sceneId, hexKeys });
    return false;
  }

  let next = state;
  const targets = [...new Set(hexKeys)].filter((hexKey) => hexHasCover(next, hexKey));
  if (!targets.length) {
    debugHexCover("removeHexCoversOnEntry: skip — no covers on target hexes", {
      sceneId,
      hexKeys,
      coverHexKeys: coverHexKeys(state.hexAnnotations),
    });
    return false;
  }

  for (const hexKey of targets) {
    next = setHexCover(next, hexKey, null);
  }

  debugHexCover("removeHexCoversOnEntry: persisting", {
    sceneId,
    targets,
    coverHexKeysBefore: coverHexKeys(state.hexAnnotations),
    coverHexKeysAfter: coverHexKeys(next.hexAnnotations),
  });

  const persisted = await persistHexMapFlag(sceneId, {
    hexAnnotations: next.hexAnnotations,
    hiddenTrailHexKeys: next.hiddenTrailHexKeys,
    showTerrainIcons: next.showTerrainIcons,
  });
  if (!persisted) return false;

  clearStagedHexcrawlMapOverlayState(sceneId);

  const { refreshHexcrawlMapOverlay } = await import("./hexcrawlMapOverlay.js");
  await refreshHexcrawlMapOverlay(sceneId, next);

  const { default: HexcrawlTravelApp } = await import("./HexcrawlTravelApp.js");
  HexcrawlTravelApp.rebindForScene(sceneId, { force: true });

  debugHexCover("removeHexCoversOnEntry: done", {
    sceneId,
    targets,
    remainingCoverHexKeys: coverHexKeys(next.hexAnnotations),
  });
  return true;
}

/** Delete a hex hide cover from the hex map flag and refresh the map overlay. */
export async function removeHexCoverOnEntry(
  sceneId: string,
  hexKey: string,
): Promise<boolean> {
  debugHexCover("removeHexCoverOnEntry: start", { sceneId, hexKey });
  return removeHexCoversOnEntry(sceneId, [hexKey]);
}

export async function saveHexcrawlSceneState(
  state: HexcrawlSceneState,
  options?: SaveHexcrawlSceneStateOptions,
): Promise<HexcrawlSceneState | null> {
  const scene = getSceneDocument(state.sceneId);
  if (!scene?.setFlag) return null;

  const writeHexMap = options?.writeHexMap !== false;
  const prepared = prepareHexcrawlStateForSave(state, state.sceneId, {
    preferFreshHexMap: !writeHexMap,
  });
  const payload: HexcrawlSceneState = {
    ...prepared,
    version: 1,
    updatedAt: Date.now(),
  };

  if (!writeHexMap) {
    const mapFresh = loadHexcrawlSceneState(state.sceneId);
    if (mapFresh) {
      payload.hexAnnotations = mapFresh.hexAnnotations;
      payload.hiddenTrailHexKeys = mapFresh.hiddenTrailHexKeys;
      payload.showTerrainIcons = mapFresh.showTerrainIcons;
    }
  }

  stageHexcrawlMapOverlayState(payload);
  if (writeHexMap) {
    const hexMapPayload = {
      ...hexMapFlagFromState(payload),
      updatedAt: payload.updatedAt + 1,
    };
    await replaceSceneModuleFlag(state.sceneId, HEXCRAWL_HEX_MAP_FLAG, hexMapPayload);
  }
  // Hex map edits live only in hexcrawlHexMap — keep main flag free of stale annotations.
  const mainPayload: HexcrawlSceneState = {
    ...payload,
    hexAnnotations: {},
    hiddenTrailHexKeys: [],
  };
  await replaceSceneModuleFlag(state.sceneId, HEXCRAWL_SCENE_STATE_FLAG, mainPayload);
  const world = (game as {
    world?: { unsetFlag?: (scope: string, key: string) => Promise<unknown> };
  }).world;
  if (world?.unsetFlag) {
    await world.unsetFlag(MODULE_ID, HEXCRAWL_JOURNEY_STATE_FLAG);
  }
  scheduleHexcrawlJournalSync(state.sceneId);
  return payload;
}

export function appendJourneyLog(
  state: HexcrawlSceneState,
  entry: Omit<JourneyLogEntry, "at">,
): HexcrawlSceneState {
  const at = Date.now();
  const hasClock = Boolean(entry.clockAt || entry.clockFrom || entry.clockTo);
  const clockAt = hasClock ? entry.clockAt : getWorldClockLabel();
  const payload: JourneyLogEntry = {
    ...entry,
    at,
    ...(clockAt ? { clockAt } : {}),
  };

  return {
    ...state,
    journeyLog: [payload, ...state.journeyLog].slice(0, 200),
    updatedAt: at,
  };
}
