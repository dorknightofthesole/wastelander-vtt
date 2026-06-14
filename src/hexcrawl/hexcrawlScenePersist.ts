import { MODULE_ID } from "../constants.js";
import { getSceneDocument } from "../scavenging/scenePersist.js";
import {
  type CourseStatus,
  navigationConditionById,
  NAVIGATION_CONDITIONS,
  normalizeTravelEventMode,
  type TravelEventMode,
} from "./travelRules.js";
import { scheduleHexcrawlJournalSync } from "./hexcrawlJournalSync.js";
import { getWorldClockLabel } from "../integrations/worldClock.js";

export const HEXCRAWL_SCENE_STATE_FLAG = "hexcrawlSceneState";
export const HEXCRAWL_JOURNAL_PAGE_FLAG = "hexcrawlJournalPageId";
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
 * Before persisting UI edits, re-read the scene flag and keep travel-hook progress
 * so dropdown/close saves cannot zero hours or drop journal entries.
 */
export function prepareHexcrawlStateForSave(
  pending: HexcrawlSceneState,
  sceneId: string,
): HexcrawlSceneState {
  const fresh = loadHexcrawlSceneState(sceneId);
  if (!fresh) return pending;

  const usePendingProgress =
    pending.journeyLog.length > fresh.journeyLog.length ||
    pending.hoursTraveledToday > fresh.hoursTraveledToday + 0.001 ||
    pending.traveledHexKeys.length > fresh.traveledHexKeys.length;

  return {
    ...(usePendingProgress ? pending : fresh),
    enabled: pending.enabled,
    travelEventMode: pending.travelEventMode,
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
  };
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

export function appendTraveledHexKey(keys: string[], hexKey: string): string[] {
  if (keys.includes(hexKey)) return keys;
  return [...keys, hexKey];
}

export function loadHexcrawlSceneState(sceneId: string): HexcrawlSceneState | null {
  const scene = getSceneDocument(sceneId);
  if (!scene) return null;
  const raw = scene.getFlag(MODULE_ID, HEXCRAWL_SCENE_STATE_FLAG);
  if (!raw) return null;
  return normalizeHexcrawlState(raw, sceneId);
}

export async function saveHexcrawlSceneState(
  state: HexcrawlSceneState,
): Promise<void> {
  const scene = getSceneDocument(state.sceneId);
  if (!scene?.setFlag) return;
  const payload: HexcrawlSceneState = {
    ...state,
    version: 1,
    updatedAt: Date.now(),
  };
  await scene.setFlag(MODULE_ID, HEXCRAWL_SCENE_STATE_FLAG, payload, {
    merge: false,
  });
  const world = (game as {
    world?: { unsetFlag?: (scope: string, key: string) => Promise<unknown> };
  }).world;
  if (world?.unsetFlag) {
    await world.unsetFlag(MODULE_ID, HEXCRAWL_JOURNEY_STATE_FLAG);
  }
  scheduleHexcrawlJournalSync(state.sceneId);
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
