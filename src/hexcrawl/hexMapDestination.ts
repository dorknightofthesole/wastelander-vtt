import { t } from "../integrations/i18n.js";
import { getUndiscoveredPoiAlpha } from "./hexcrawlSettings.js";
import {
  appendJourneyLog,
  appendTraveledHexKey,
  loadHexcrawlSceneState,
  saveHexcrawlSceneState,
  type HexcrawlSceneState,
  type SceneCardinal,
  type SceneLinks,
} from "./hexcrawlScenePersist.js";

export type MapDestination = {
  hexKey: string;
  name: string;
};

/** Cached linked-scene destination for Progress when this scene has no local marker. */
export type InheritedProgressDestination = {
  name: string;
  hexKey: string;
  sourceSceneId: string;
  sourceSceneName: string;
};

export type MapDestinationArrival = {
  hexKey: string;
  name: string;
};

export type ResolvedProgressDestination = {
  name: string;
  hexKey: string | null;
  sourceSceneId: string;
  sourceSceneName: string;
  inherited: boolean;
};

const SCENE_CARDINALS: SceneCardinal[] = ["north", "south", "east", "west"];

/** Max scene-link hops when inheriting a Progress destination from linked overworld maps. */
export const LINKED_MAP_DESTINATION_MAX_DEPTH = 3;

function neighborSceneIds(sceneLinks: SceneLinks): string[] {
  const ids: string[] = [];
  for (const direction of SCENE_CARDINALS) {
    const linkedSceneId = sceneLinks[direction];
    if (linkedSceneId) ids.push(linkedSceneId);
  }
  return ids;
}

function appendFrontierNeighbors(
  frontier: string[],
  visited: Set<string>,
): string[] {
  const next: string[] = [];
  for (const sceneId of frontier) {
    const linkedState = loadHexcrawlSceneState(sceneId);
    if (!linkedState) continue;
    for (const linkedSceneId of neighborSceneIds(linkedState.sceneLinks)) {
      if (visited.has(linkedSceneId)) continue;
      visited.add(linkedSceneId);
      next.push(linkedSceneId);
    }
  }
  return next;
}

/** Breadth-first search along scene N/S/E/W links, cardinal order within each depth. */
function sceneReachableViaLinks(
  state: HexcrawlSceneState,
  targetSceneId: string,
  maxDepth = LINKED_MAP_DESTINATION_MAX_DEPTH,
): boolean {
  if (targetSceneId === state.sceneId) return true;
  if (maxDepth < 1) return false;

  const visited = new Set<string>([state.sceneId]);
  let frontier: string[] = [];
  for (const linkedSceneId of neighborSceneIds(state.sceneLinks)) {
    if (visited.has(linkedSceneId)) continue;
    visited.add(linkedSceneId);
    frontier.push(linkedSceneId);
  }

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (frontier.includes(targetSceneId)) return true;
    if (depth === maxDepth) break;
    frontier = appendFrontierNeighbors(frontier, visited);
    if (!frontier.length) break;
  }

  return false;
}

function resolveLinkedMapDestination(
  originSceneId: string,
  sceneLinks: SceneLinks,
  maxDepth = LINKED_MAP_DESTINATION_MAX_DEPTH,
): ResolvedProgressDestination | null {
  if (maxDepth < 1) return null;

  const visited = new Set<string>([originSceneId]);
  let frontier: string[] = [];
  for (const linkedSceneId of neighborSceneIds(sceneLinks)) {
    if (visited.has(linkedSceneId)) continue;
    visited.add(linkedSceneId);
    frontier.push(linkedSceneId);
  }

  for (let depth = 1; depth <= maxDepth; depth++) {
    for (const sceneId of frontier) {
      const linkedState = loadHexcrawlSceneState(sceneId);
      if (!linkedState?.mapDestination?.name) continue;
      return {
        name: linkedState.mapDestination.name,
        hexKey: linkedState.mapDestination.hexKey,
        sourceSceneId: sceneId,
        sourceSceneName: sceneNameForId(sceneId),
        inherited: true,
      };
    }

    if (depth === maxDepth) break;
    frontier = appendFrontierNeighbors(frontier, visited);
    if (!frontier.length) break;
  }

  return null;
}

export function normalizeMapDestination(raw: unknown): MapDestination | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { hexKey?: unknown; name?: unknown };
  if (typeof row.hexKey !== "string" || !row.hexKey.trim()) return null;
  if (typeof row.name !== "string" || !row.name.trim()) return null;
  return { hexKey: row.hexKey.trim(), name: row.name.trim() };
}

export function normalizeInheritedProgressDestination(
  raw: unknown,
): InheritedProgressDestination | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as {
    name?: unknown;
    hexKey?: unknown;
    sourceSceneId?: unknown;
    sourceSceneName?: unknown;
  };
  if (typeof row.name !== "string" || !row.name.trim()) return null;
  if (typeof row.hexKey !== "string" || !row.hexKey.trim()) return null;
  if (typeof row.sourceSceneId !== "string" || !row.sourceSceneId.trim()) return null;
  if (typeof row.sourceSceneName !== "string" || !row.sourceSceneName.trim()) return null;
  return {
    name: row.name.trim(),
    hexKey: row.hexKey.trim(),
    sourceSceneId: row.sourceSceneId.trim(),
    sourceSceneName: row.sourceSceneName.trim(),
  };
}

export function promptForDestinationName(defaultName = ""): Promise<string | null> {
  return new Promise((resolve) => {
    const DialogClass = (globalThis as { Dialog?: typeof Dialog }).Dialog;
    if (!DialogClass) {
      resolve(null);
      return;
    }

    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const dialog = new DialogClass(
      {
        title: t("WASTELANDER.Hexcrawl.MapDestinationNameTitle"),
        content: `<div class="form-group">
          <label>${t("WASTELANDER.Hexcrawl.MapDestinationNameLabel")}</label>
          <input type="text" name="destinationName" value="${foundry.utils.escapeHTML(defaultName)}" autofocus />
        </div>`,
        buttons: {
          ok: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("Confirm"),
            callback: (html: JQuery) => {
              const value = String(html.find('[name="destinationName"]').val() ?? "").trim();
              finish(value || null);
            },
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: game.i18n.localize("Cancel"),
            callback: () => finish(null),
          },
        },
        default: "ok",
        close: () => finish(null),
      },
      { width: 420 },
    );
    dialog.render(true);
  });
}

export function setMapDestination(
  state: HexcrawlSceneState,
  hexKey: string,
  name: string,
): HexcrawlSceneState {
  const trimmedHex = hexKey.trim();
  const trimmedName = name.trim();
  if (!trimmedHex || !trimmedName) {
    return clearMapDestination(state);
  }

  const unchanged =
    state.mapDestination?.hexKey === trimmedHex &&
    state.mapDestination.name === trimmedName;
  if (unchanged) return state;

  return {
    ...state,
    mapDestination: { hexKey: trimmedHex, name: trimmedName },
    mapDestinationReached:
      state.mapDestination?.hexKey === trimmedHex ? state.mapDestinationReached : false,
    inheritedProgressDestination: null,
  };
}

export function clearMapDestination(state: HexcrawlSceneState): HexcrawlSceneState {
  if (!state.mapDestination && !state.inheritedProgressDestination) return state;
  return {
    ...state,
    mapDestination: null,
    mapDestinationReached: false,
  };
}

export function invalidateInheritedProgressDestination(
  state: HexcrawlSceneState,
): HexcrawlSceneState {
  if (!state.inheritedProgressDestination) return state;
  return { ...state, inheritedProgressDestination: null };
}

export function shouldShowMapDestination(
  state: Pick<HexcrawlSceneState, "mapDestination" | "mapDestinationReached">,
  revealAll: boolean,
): boolean {
  if (!state.mapDestination) return false;
  if (revealAll) return true;
  return state.mapDestinationReached;
}

export function mapDestinationDisplayAlpha(
  state: Pick<HexcrawlSceneState, "mapDestinationReached">,
  revealAll: boolean,
  undiscoveredAlpha?: number,
): number {
  if (!revealAll) return 1;
  if (state.mapDestinationReached) return 1;
  return undiscoveredAlpha ?? getUndiscoveredPoiAlpha();
}

export function applyDestinationArrivalProgress(
  state: HexcrawlSceneState,
  arrivalHexKey: string,
): HexcrawlSceneState {
  const hexKey = arrivalHexKey.trim();
  return {
    ...state,
    hoursTraveledToday: 0,
    milesTraveledCumulative: 0,
    startingHexKey: hexKey,
    lastHexKey: hexKey,
    trailCleared: false,
    traveledHexKeys: appendTraveledHexKey(state.traveledHexKeys, hexKey),
  };
}

export function discoverMapDestinationOnHexEntry(
  state: HexcrawlSceneState,
  hexKey: string,
): { state: HexcrawlSceneState; arrival: MapDestinationArrival | null } {
  const destination = state.mapDestination;
  if (!destination || destination.hexKey !== hexKey) {
    return { state, arrival: null };
  }

  const arrival: MapDestinationArrival = {
    hexKey,
    name: destination.name,
  };
  const next = invalidateInheritedProgressDestination(
    clearMapDestination(
      appendJourneyLog(
        applyDestinationArrivalProgress(state, hexKey),
        {
          kind: "destinationReached",
          travelDay: state.travelDay,
          hexKey,
          poiLabel: destination.name,
          note: destination.name,
        },
      ),
    ),
  );
  return { state: next, arrival };
}

/** Clear inherited destination labels on scenes that referenced a completed destination. */
export async function purgeInheritedDestinationFromLinkedScenes(
  sourceSceneId: string,
): Promise<string[]> {
  const updatedSceneIds: string[] = [];
  const scenes =
    (game as { scenes?: { contents?: Array<{ id: string }> } }).scenes?.contents ?? [];
  for (const scene of scenes) {
    if (scene.id === sourceSceneId) continue;
    const state = loadHexcrawlSceneState(scene.id);
    if (!state?.inheritedProgressDestination) continue;
    if (state.inheritedProgressDestination.sourceSceneId !== sourceSceneId) continue;
    const next = invalidateInheritedProgressDestination(state);
    const saved = await saveHexcrawlSceneState(next, { writeHexMap: false });
    if (saved) updatedSceneIds.push(scene.id);
  }
  return updatedSceneIds;
}

export async function handleMapDestinationArrival(params: {
  sceneId: string;
  tokenId: string | null;
  state: HexcrawlSceneState;
  arrival: MapDestinationArrival;
}): Promise<HexcrawlSceneState> {
  const { notifyDestinationArrived } = await import("./destinationArrivalChat.js");
  notifyDestinationArrived(params.arrival);

  const { moveTokenToHexKey } = await import("./hexcrawlTravel.js");
  const purgedSceneIds = await purgeInheritedDestinationFromLinkedScenes(params.sceneId);
  const { refreshHexcrawlMapOverlay } = await import("./hexcrawlMapOverlay.js");

  let state = params.state;
  if (params.tokenId) {
    await moveTokenToHexKey(params.sceneId, params.tokenId, params.arrival.hexKey);
  }

  await refreshHexcrawlMapOverlay(params.sceneId, state);
  for (const sceneId of purgedSceneIds) {
    const linkedState = loadHexcrawlSceneState(sceneId);
    if (linkedState) await refreshHexcrawlMapOverlay(sceneId, linkedState);
  }

  const { default: HexcrawlTravelApp } = await import("./HexcrawlTravelApp.js");
  HexcrawlTravelApp.rebindForScene(params.sceneId, { force: true });

  return state;
}

function sceneNameForId(sceneId: string): string {
  const scene = (game as { scenes?: { get: (id: string) => { name?: string } | undefined } })
    .scenes?.get(sceneId);
  return scene?.name ?? sceneId;
}

export function inheritedProgressDestinationStillValid(
  state: HexcrawlSceneState,
  cache: InheritedProgressDestination,
): boolean {
  if (!sceneReachableViaLinks(state, cache.sourceSceneId)) return false;
  const source = loadHexcrawlSceneState(cache.sourceSceneId);
  if (!source?.mapDestination?.name) return false;
  return (
    source.mapDestination.name === cache.name &&
    source.mapDestination.hexKey === cache.hexKey
  );
}

function inheritedCacheFromResolved(
  resolved: ResolvedProgressDestination,
): InheritedProgressDestination {
  return {
    name: resolved.name,
    hexKey: resolved.hexKey ?? "",
    sourceSceneId: resolved.sourceSceneId,
    sourceSceneName: resolved.sourceSceneName,
  };
}

/** Persist linked-scene destination locally so Progress does not re-scan every open. */
export function ensureInheritedProgressDestinationCached(
  state: HexcrawlSceneState,
): { state: HexcrawlSceneState; changed: boolean } {
  if (state.mapDestination?.name) {
    if (!state.inheritedProgressDestination) return { state, changed: false };
    return {
      state: { ...state, inheritedProgressDestination: null },
      changed: true,
    };
  }

  let next = state;
  let changed = false;

  if (
    next.inheritedProgressDestination &&
    !inheritedProgressDestinationStillValid(next, next.inheritedProgressDestination)
  ) {
    next = invalidateInheritedProgressDestination(next);
    changed = true;
  }

  const cache = next.inheritedProgressDestination;
  if (cache && inheritedProgressDestinationStillValid(next, cache)) {
    const refreshedName = sceneNameForId(cache.sourceSceneId);
    if (refreshedName !== cache.sourceSceneName) {
      return {
        state: {
          ...next,
          inheritedProgressDestination: { ...cache, sourceSceneName: refreshedName },
        },
        changed: true,
      };
    }
    return { state: next, changed };
  }

  const resolved = resolveLinkedMapDestination(next.sceneId, next.sceneLinks);
  if (!resolved) {
    if (!next.inheritedProgressDestination) return { state: next, changed };
    return {
      state: { ...next, inheritedProgressDestination: null },
      changed: true,
    };
  }

  const nextCache = inheritedCacheFromResolved(resolved);
  const prior = next.inheritedProgressDestination;
  if (
    prior &&
    prior.name === nextCache.name &&
    prior.hexKey === nextCache.hexKey &&
    prior.sourceSceneId === nextCache.sourceSceneId &&
    prior.sourceSceneName === nextCache.sourceSceneName
  ) {
    return { state: next, changed };
  }

  return {
    state: { ...next, inheritedProgressDestination: nextCache },
    changed: true,
  };
}

/** Destination label for Progress — local scene first, then cached or linked overworld scenes. */
export function resolveProgressDestination(
  sceneId: string,
  state: HexcrawlSceneState,
): ResolvedProgressDestination | null {
  if (state.mapDestination?.name) {
    return {
      name: state.mapDestination.name,
      hexKey: state.mapDestination.hexKey,
      sourceSceneId: sceneId,
      sourceSceneName: sceneNameForId(sceneId),
      inherited: false,
    };
  }

  const cache = state.inheritedProgressDestination;
  if (cache && inheritedProgressDestinationStillValid(state, cache)) {
    return {
      name: cache.name,
      hexKey: cache.hexKey,
      sourceSceneId: cache.sourceSceneId,
      sourceSceneName: sceneNameForId(cache.sourceSceneId),
      inherited: true,
    };
  }

  return resolveLinkedMapDestination(sceneId, state.sceneLinks);
}

export function formatProgressDestinationLabel(
  resolved: ResolvedProgressDestination,
): string {
  const name = resolved.name.trim();
  if (!name) return "";
  if (!resolved.inherited) return name;
  const sceneName = resolved.sourceSceneName.trim();
  return sceneName ? `${name} (${sceneName})` : name;
}

export function progressDestinationDisplayLabel(
  sceneId: string | null,
  state: HexcrawlSceneState,
  notSetLabel: string,
): string {
  if (!sceneId) return notSetLabel;
  const resolved = resolveProgressDestination(sceneId, state);
  if (!resolved?.name?.trim()) return notSetLabel;
  return formatProgressDestinationLabel(resolved) || notSetLabel;
}

export function backfillMapDestinationReached(state: HexcrawlSceneState): HexcrawlSceneState {
  if (!state.mapDestination || state.mapDestinationReached) return state;
  const traveled = new Set([
    ...state.traveledHexKeys,
    ...(state.startingHexKey ? [state.startingHexKey] : []),
    ...(state.lastHexKey ? [state.lastHexKey] : []),
  ]);
  if (!traveled.has(state.mapDestination.hexKey)) return state;
  return { ...state, mapDestinationReached: true };
}
