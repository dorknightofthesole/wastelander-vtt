import { MODULE_ID } from "../constants.js";
import type {
  InhabitantType,
  LocationCategoryId,
  LocationDegree,
  LocationScale,
  PartyActorRow,
  ScavengerLocation,
  ScavengerLocationProblems,
} from "./ScavengerLocation.js";
import { getPartyActorsOnScene } from "./partyContext.js";
import { scheduleScavengerJournalSync } from "./scavengerJournalSync.js";
import {
  normalizePlayerSearch,
  type ScavengerPlayerSearchState,
} from "./playerSearchState.js";

export const SCENE_STATE_FLAG = "scavengerSceneState";

/** Player scavenge progress — separate flag so reset can use unsetFlag reliably. */
export const SCENE_PLAYER_SEARCH_FLAG = "scavengerPlayerSearch";

export type ScavengerTab = "current" | "create";

export type ScavengerFormState = {
  name: string;
  concept: string;
  scale: LocationScale;
  categoryId: LocationCategoryId;
  degree: LocationDegree;
  inhabitantType: InhabitantType;
  problems: ScavengerLocationProblems;
};

export type ScavengerScenePersistedState = {
  version: 1 | 2;
  sceneId: string;
  form: ScavengerFormState;
  location: ScavengerLocation | null;
  activeTab: ScavengerTab;
  /** actorId → selected for party on this scene */
  partySelections: Record<string, boolean>;
  /** Shared party scavenging progress for the player UI */
  playerSearch?: ScavengerPlayerSearchState;
  updatedAt: number;
};

const DEFAULT_PROBLEMS: ScavengerLocationProblems = {
  obstacle: false,
  hazard: false,
  inhabitants: true,
  inhabitantType: "raiders",
  obstacleType: "mechanical",
  hazardKind: "ongoing",
};

export function defaultFormState(): ScavengerFormState {
  return {
    name: "New scavenger location",
    concept: "",
    scale: "average",
    categoryId: "residential",
    degree: "partly",
    inhabitantType: "raiders",
    problems: { ...DEFAULT_PROBLEMS },
  };
}

export function getActiveSceneId(): string | undefined {
  const canvas = (globalThis as { canvas?: { scene?: { id: string } | null } })
    .canvas;
  return canvas?.scene?.id;
}

type SceneFlagDoc = {
  getFlag: (scope: string, key: string) => unknown;
  setFlag: (
    scope: string,
    key: string,
    value: unknown,
    options?: { merge?: boolean },
  ) => Promise<unknown>;
  unsetFlag?: (scope: string, key: string) => Promise<unknown>;
  name?: string;
};

export function getSceneDocument(sceneId: string): SceneFlagDoc | undefined {
  return game.scenes.get(sceneId) as SceneFlagDoc | undefined;
}

/** Read player search from dedicated flag, else legacy field inside scavengerSceneState. */
export function loadPlayerSearchForScene(
  sceneId: string,
): ScavengerPlayerSearchState | undefined {
  const scene = getSceneDocument(sceneId);
  if (!scene) return undefined;

  const dedicated = normalizePlayerSearch(
    scene.getFlag(MODULE_ID, SCENE_PLAYER_SEARCH_FLAG),
  );
  if (dedicated) return dedicated;

  const raw = scene.getFlag(MODULE_ID, SCENE_STATE_FLAG);
  if (!raw || typeof raw !== "object") return undefined;

  const legacy = normalizePlayerSearch(
    (raw as { playerSearch?: unknown }).playerSearch,
  );
  if (!legacy) return undefined;

  // Stale embedded copy could survive a failed reset (Foundry flag merge). Drop failed legacy on read.
  if (legacy.searchSuccess === false) {
    void stripLegacyEmbeddedPlayerSearch(sceneId);
    return undefined;
  }

  return legacy;
}

export async function savePlayerSearchForScene(
  sceneId: string,
  playerSearch: ScavengerPlayerSearchState | null,
): Promise<void> {
  const scene = getSceneDocument(sceneId);
  if (!scene) return;

  if (playerSearch === null) {
    if (scene.unsetFlag) {
      await scene.unsetFlag(MODULE_ID, SCENE_PLAYER_SEARCH_FLAG);
    }
  } else {
    await scene.setFlag(MODULE_ID, SCENE_PLAYER_SEARCH_FLAG, playerSearch, {
      merge: false,
    });
  }

  await stripLegacyEmbeddedPlayerSearch(sceneId);
  scheduleScavengerJournalSync(sceneId);
}

/** Remove playerSearch from the main scavengerSceneState flag (old saves). */
export async function stripLegacyEmbeddedPlayerSearch(
  sceneId: string,
): Promise<void> {
  const scene = getSceneDocument(sceneId);
  if (!scene) return;

  const raw = scene.getFlag(MODULE_ID, SCENE_STATE_FLAG);
  if (!raw || typeof raw !== "object") return;
  if (!("playerSearch" in (raw as Record<string, unknown>))) return;

  const duplicate = foundry.utils.duplicate(raw) as Record<string, unknown>;
  delete duplicate.playerSearch;
  await scene.setFlag(MODULE_ID, SCENE_STATE_FLAG, duplicate, { merge: false });
}

export function partySelectionMap(party: PartyActorRow[]): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const row of party) {
    map[row.actorId] = row.selected;
  }
  return map;
}

export function mergePartySelections(
  fresh: PartyActorRow[],
  saved: Record<string, boolean> | undefined,
): PartyActorRow[] {
  if (!saved) return fresh;
  return fresh.map((row) => ({
    ...row,
    selected: saved[row.actorId] ?? row.selected,
  }));
}

function normalizeTab(value: unknown): ScavengerTab {
  return value === "create" ? "create" : "current";
}

function normalizeForm(raw: unknown): ScavengerFormState {
  const base = defaultFormState();
  if (!raw || typeof raw !== "object") return base;
  const f = raw as Partial<ScavengerFormState>;
  const scale =
    f.scale === "tiny" ||
    f.scale === "small" ||
    f.scale === "average" ||
    f.scale === "large"
      ? f.scale
      : base.scale;
  const categoryId =
    f.categoryId === "residential" ||
    f.categoryId === "commercial" ||
    f.categoryId === "industry" ||
    f.categoryId === "medical" ||
    f.categoryId === "agriculture" ||
    f.categoryId === "military"
      ? f.categoryId
      : base.categoryId;
  const degree =
    f.degree === "untouched" ||
    f.degree === "partly" ||
    f.degree === "mostly" ||
    f.degree === "heavily"
      ? f.degree
      : base.degree;
  const inhabitantType =
    f.inhabitantType === "animals" ||
    f.inhabitantType === "feralGhouls" ||
    f.inhabitantType === "raiders" ||
    f.inhabitantType === "superMutants" ||
    f.inhabitantType === "robots" ||
    f.inhabitantType === "overseerOverride"
      ? f.inhabitantType
      : base.inhabitantType;

  const problems = { ...base.problems, ...(f.problems as object) };
  if (typeof problems.obstacle !== "boolean") problems.obstacle = base.problems.obstacle;
  if (typeof problems.hazard !== "boolean") problems.hazard = base.problems.hazard;
  if (typeof problems.inhabitants !== "boolean") {
    problems.inhabitants = base.problems.inhabitants;
  }

  return {
    name: typeof f.name === "string" ? f.name : base.name,
    concept: typeof f.concept === "string" ? f.concept : base.concept,
    scale,
    categoryId,
    degree,
    inhabitantType,
    problems,
  };
}

function normalizeLocation(
  raw: unknown,
  sceneId: string,
): ScavengerLocation | null {
  if (!raw || typeof raw !== "object") return null;
  const loc = raw as ScavengerLocation;
  if (typeof loc.id !== "string" || typeof loc.level !== "number") return null;
  return { ...loc, sceneId };
}

export function loadScavengerSceneState(
  sceneId: string,
): ScavengerScenePersistedState | null {
  const scene = getSceneDocument(sceneId);
  if (!scene) return null;

  const raw = scene.getFlag(MODULE_ID, SCENE_STATE_FLAG);
  if (!raw || typeof raw !== "object") return null;

  const data = raw as Partial<ScavengerScenePersistedState>;
  const partySelections =
    data.partySelections && typeof data.partySelections === "object"
      ? (data.partySelections as Record<string, boolean>)
      : {};

  const version = data.version === 2 ? 2 : 1;
  const playerSearch = loadPlayerSearchForScene(sceneId);

  return {
    version,
    sceneId,
    form: normalizeForm(data.form),
    location: normalizeLocation(data.location, sceneId),
    activeTab: normalizeTab(data.activeTab),
    partySelections,
    playerSearch,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
  };
}

export function buildPersistedSceneState(params: {
  sceneId: string;
  form: ScavengerFormState;
  location: ScavengerLocation | null;
  activeTab: ScavengerTab;
  party: PartyActorRow[];
}): ScavengerScenePersistedState {
  const location = params.location
    ? { ...params.location, sceneId: params.sceneId }
    : null;

  const base: ScavengerScenePersistedState = {
    version: 2,
    sceneId: params.sceneId,
    form: params.form,
    location,
    activeTab: params.activeTab,
    partySelections: partySelectionMap(params.party),
    updatedAt: Date.now(),
  };
  return base;
}

/** Strip undefined playerSearch so Foundry flag merge does not keep a stale object. */
export function scavengerSceneStateForFlag(
  state: ScavengerScenePersistedState,
): ScavengerScenePersistedState {
  const payload: ScavengerScenePersistedState = {
    ...state,
    partySelections: { ...state.partySelections },
  };
  if (payload.playerSearch === undefined) {
    delete payload.playerSearch;
  }
  return payload;
}

export async function saveScavengerSceneState(
  state: ScavengerScenePersistedState,
): Promise<void> {
  const scene = getSceneDocument(state.sceneId);
  if (!scene?.setFlag) return;
  const payload = scavengerSceneStateForFlag(state);
  await scene.setFlag(MODULE_ID, SCENE_STATE_FLAG, payload, { merge: false });
}

export async function persistScavengerSceneState(params: {
  sceneId: string;
  form: ScavengerFormState;
  location: ScavengerLocation | null;
  activeTab: ScavengerTab;
  party: PartyActorRow[];
  clearPlayerSearch?: boolean;
}): Promise<void> {
  if (params.clearPlayerSearch) {
    await savePlayerSearchForScene(params.sceneId, null);
  }
  await saveScavengerSceneState(buildPersistedSceneState(params));
  scheduleScavengerJournalSync(params.sceneId);
}

/** Apply saved state to app fields; refreshes party from scene tokens. */
export function applyScavengerSceneState(
  saved: ScavengerScenePersistedState | null,
  sceneId: string,
): {
  form: ScavengerFormState;
  location: ScavengerLocation | null;
  activeTab: ScavengerTab;
  party: PartyActorRow[];
} {
  const freshParty = getPartyActorsOnScene(sceneId);
  if (!saved) {
    return {
      form: defaultFormState(),
      location: null,
      activeTab: "current",
      party: freshParty,
    };
  }

  return {
    form: saved.form,
    location: saved.location,
    activeTab: saved.activeTab,
    party: mergePartySelections(freshParty, saved.partySelections),
  };
}
