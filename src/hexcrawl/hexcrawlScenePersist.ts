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
  | "travelReset";

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
  updatedAt: number;
};

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
    updatedAt: Date.now(),
  };
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

export function normalizeHexcrawlState(
  raw: unknown,
  sceneId: string,
): HexcrawlSceneState {
  const base = defaultHexcrawlState(sceneId);
  if (!raw || typeof raw !== "object") return base;
  const data = raw as Partial<HexcrawlSceneState>;
  const navigationConditionId =
    typeof data.navigationConditionId === "string"
      ? data.navigationConditionId
      : base.navigationConditionId;
  const condition = navigationConditionById(navigationConditionId);
  const baseDifficulty =
    typeof data.baseDifficulty === "number"
      ? data.baseDifficulty
      : (condition?.baseDifficulty ?? base.baseDifficulty);

  return {
    ...base,
    enabled: Boolean(data.enabled),
    travelEventMode: normalizeTravelEventMode(data.travelEventMode),
    travelTokenId:
      typeof data.travelTokenId === "string" ? data.travelTokenId : null,
    partyActorIds: Array.isArray(data.partyActorIds)
      ? data.partyActorIds.filter((id) => typeof id === "string")
      : [],
    navigatorActorId:
      typeof data.navigatorActorId === "string" ? data.navigatorActorId : null,
    navigationConditionId,
    baseDifficulty,
    currentDifficulty:
      typeof data.currentDifficulty === "number"
        ? data.currentDifficulty
        : baseDifficulty,
    courseStatus: data.courseStatus === "lost" ? "lost" : "onCourse",
    maxHoursPerDay:
      typeof data.maxHoursPerDay === "number" && data.maxHoursPerDay > 0
        ? Math.min(12, Math.floor(data.maxHoursPerDay))
        : base.maxHoursPerDay,
    hoursTraveledToday:
      typeof data.hoursTraveledToday === "number"
        ? Math.max(0, data.hoursTraveledToday)
        : 0,
    travelDay:
      typeof data.travelDay === "number" && data.travelDay >= 1
        ? Math.floor(data.travelDay)
        : 1,
    lastHexKey: typeof data.lastHexKey === "string" ? data.lastHexKey : null,
    startingHexKey:
      typeof data.startingHexKey === "string" ? data.startingHexKey : null,
    resetTravelPending: normalizeResetTravelPending(data.resetTravelPending),
    arrived: Boolean(data.arrived),
    pendingDayEnd: Boolean(data.pendingDayEnd),
    courseCheckResolved: Boolean(data.courseCheckResolved),
    journeyLog: normalizeJourneyLog(data.journeyLog),
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
  };
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
    updatedAt: Date.now(),
  };
  await scene.setFlag(MODULE_ID, HEXCRAWL_SCENE_STATE_FLAG, payload, {
    merge: false,
  });
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
