import { getPartyActorsOnScene } from "./partyContext.js";
import {
  normalizePlayerSearch,
  type ScavengerPlayerSearchState,
} from "./playerSearchState.js";
import { loadScavengerSceneState } from "./scenePersist.js";

export type SearchRerollWatchRole = "assist" | "primary";

/** GM-client watch: listen for this user's Fallout chat re-rolls after a scavenge roll. */
export type SearchRerollWatch = {
  sceneId: string;
  actorId: string;
  userId: string;
  role: SearchRerollWatchRole;
};

const watchesByScene = new Map<string, SearchRerollWatch[]>();
/** Scavenge UI was closed — do not rebuild watches from scene state until a new roll. */
const suppressedScenes = new Set<string>();

function sceneWatches(sceneId: string): SearchRerollWatch[] {
  return watchesByScene.get(sceneId) ?? [];
}

function setSceneWatches(sceneId: string, watches: SearchRerollWatch[]): void {
  if (watches.length) {
    watchesByScene.set(sceneId, watches);
  } else {
    watchesByScene.delete(sceneId);
  }
}

export function registerRerollWatch(watch: SearchRerollWatch): void {
  const list = sceneWatches(watch.sceneId).filter(
    (entry) => !(entry.role === watch.role && entry.actorId === watch.actorId),
  );
  list.push(watch);
  setSceneWatches(watch.sceneId, list);
}

/** Assist Miss Fortune is only meaningful before the primary search roll. */
export function clearAssistRerollWatches(sceneId: string): void {
  setSceneWatches(
    sceneId,
    sceneWatches(sceneId).filter((entry) => entry.role !== "assist"),
  );
}

export function clearPrimaryRerollWatch(sceneId: string, actorId?: string): void {
  setSceneWatches(
    sceneId,
    sceneWatches(sceneId).filter(
      (entry) =>
        entry.role !== "primary" || (actorId !== undefined && entry.actorId !== actorId),
    ),
  );
}

export function clearAllRerollWatches(sceneId: string): void {
  watchesByScene.delete(sceneId);
  suppressedScenes.delete(sceneId);
}

/** Clear watches for one user when they close the Scavenge window. */
export function suppressRerollWatchesForUser(sceneId: string, userId: string): void {
  const remaining = sceneWatches(sceneId).filter((entry) => entry.userId !== userId);
  setSceneWatches(sceneId, remaining);
  if (remaining.length === 0) {
    suppressedScenes.add(sceneId);
  }
}

/** @deprecated Prefer {@link suppressRerollWatchesForUser}. */
export function suppressRerollWatchesForScene(sceneId: string): void {
  watchesByScene.delete(sceneId);
  suppressedScenes.add(sceneId);
}

function resumeRerollWatchesForScene(sceneId: string): void {
  suppressedScenes.delete(sceneId);
}

/**
 * Find an active watch for a chat re-roll author on the given scene.
 * Primary takes precedence when both exist (should not happen for one user).
 */
export function findRerollWatch(
  sceneId: string,
  userId: string,
): SearchRerollWatch | null {
  const matches = sceneWatches(sceneId).filter((entry) => entry.userId === userId);
  if (!matches.length) return null;
  return matches.find((entry) => entry.role === "primary") ?? matches[0] ?? null;
}

/** Prefer active scene; fall back to any scene with a watch for this user. */
export function findRerollWatchForAuthor(userId: string): SearchRerollWatch | null {
  const activeSceneId = canvas?.scene?.id;
  if (activeSceneId) {
    const onActive = findRerollWatch(activeSceneId, userId);
    if (onActive) return onActive;
  }
  for (const [, watches] of watchesByScene) {
    const primary = watches.find(
      (entry) => entry.userId === userId && entry.role === "primary",
    );
    if (primary) return primary;
    const assist = watches.find(
      (entry) => entry.userId === userId && entry.role === "assist",
    );
    if (assist) return assist;
  }
  return null;
}

export function findRerollWatchByActorId(actorId: string): SearchRerollWatch | null {
  for (const [, watches] of watchesByScene) {
    const match = watches.find((entry) => entry.actorId === actorId);
    if (match) return match;
  }
  return null;
}

export function listRerollWatchesForScene(
  sceneId: string,
  role?: SearchRerollWatchRole,
): SearchRerollWatch[] {
  return sceneWatches(sceneId).filter((entry) => !role || entry.role === role);
}

export function listAllRerollWatches(role?: SearchRerollWatchRole): SearchRerollWatch[] {
  return [...watchesByScene.values()]
    .flat()
    .filter((entry) => !role || entry.role === role);
}

/** User id of the player who owns the character (for display / player self-roll). */
export function watchUserIdForActor(
  sceneId: string,
  actorId: string,
  actingUserId: string,
): string {
  const owner = getPartyActorsOnScene(sceneId).find((row) => row.actorId === actorId);
  return owner?.userId ?? actingUserId;
}

/**
 * Rebuild watches from persisted search state (GM refresh / scene activate).
 *
 * Assist: while search is still pending (no primary roll yet).
 * Primary: only while search is recorded as failed — until Miss Fortune succeeds or reset.
 */
export function rebuildRerollWatchesFromState(
  sceneId: string,
  playerSearch: ScavengerPlayerSearchState,
): void {
  if (suppressedScenes.has(sceneId)) return;

  clearAllRerollWatches(sceneId);

  if (playerSearch.searchSuccess === true) {
    return;
  }

  if (playerSearch.searchSuccess === null) {
    for (const [actorId, log] of Object.entries(playerSearch.assistRolls)) {
      registerRerollWatch({
        sceneId,
        actorId,
        userId: log.userId,
        role: "assist",
      });
    }
    return;
  }

  if (playerSearch.searchSuccess === false && playerSearch.searchRollLog) {
    const log = playerSearch.searchRollLog;
    registerRerollWatch({
      sceneId,
      actorId: log.actorId,
      userId: log.userId,
      role: "primary",
    });
  }
}

export function rebuildRerollWatchesForScene(sceneId: string): void {
  const state = loadScavengerSceneState(sceneId);
  const playerSearch = normalizePlayerSearch(state?.playerSearch);
  if (!playerSearch) {
    clearAllRerollWatches(sceneId);
    return;
  }
  rebuildRerollWatchesFromState(sceneId, playerSearch);
}

/** Called when an assist scavenge roll is saved. */
export function onAssistSearchRollCommitted(
  sceneId: string,
  actorId: string,
  userId: string,
): void {
  resumeRerollWatchesForScene(sceneId);
  registerRerollWatch({
    sceneId,
    actorId,
    userId: watchUserIdForActor(sceneId, actorId, userId),
    role: "assist",
  });
}

/**
 * Called when a primary scavenge roll is saved.
 * Failed primary keeps watching for Miss Fortune; success stops immediately.
 */
export function onPrimarySearchRollCommitted(
  sceneId: string,
  actorId: string,
  userId: string,
  searchSucceeded: boolean,
): void {
  resumeRerollWatchesForScene(sceneId);
  clearAssistRerollWatches(sceneId);
  if (searchSucceeded) {
    clearPrimaryRerollWatch(sceneId);
    return;
  }
  registerRerollWatch({
    sceneId,
    actorId,
    userId: watchUserIdForActor(sceneId, actorId, userId),
    role: "primary",
  });
}

/** Called when a primary Miss Fortune re-roll flips the search to success. */
export function onPrimarySearchRerollSucceeded(sceneId: string, actorId: string): void {
  clearPrimaryRerollWatch(sceneId, actorId);
}
