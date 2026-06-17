import type { HexcrawlSceneState } from "./hexcrawlScenePersist.js";

const stagedByScene = new Map<string, HexcrawlSceneState>();

/** When true, overseers see player map fog (hidden undiscovered POIs, full opacity). */
let mapPlayerPreview = false;

export function setHexcrawlMapPlayerPreview(enabled: boolean): void {
  mapPlayerPreview = enabled;
}

export function isHexcrawlMapPlayerPreview(): boolean {
  return mapPlayerPreview;
}

export function resolveMapFogRevealAll(isOverseer: boolean): boolean {
  return isOverseer && !mapPlayerPreview;
}

/** Keep the latest saved/edited state for overlay draws until the scene flag catches up. */
export function stageHexcrawlMapOverlayState(state: HexcrawlSceneState): void {
  stagedByScene.set(state.sceneId, state);
}

export function clearStagedHexcrawlMapOverlayState(sceneId?: string): void {
  if (sceneId) stagedByScene.delete(sceneId);
  else stagedByScene.clear();
}

export function resolveHexcrawlMapOverlayState(
  sceneId: string,
  loaded: HexcrawlSceneState | null,
): HexcrawlSceneState | null {
  const staged = stagedByScene.get(sceneId);
  if (!staged) return loaded;
  if (!loaded) return staged;

  if (loaded.updatedAt > staged.updatedAt) {
    stagedByScene.delete(sceneId);
    return loaded;
  }

  // Map annotations live only in hexcrawlHexMap — never resurrect covers from staged UI state.
  const traveledHexKeys =
    staged.traveledHexKeys.length >= loaded.traveledHexKeys.length
      ? staged.traveledHexKeys
      : loaded.traveledHexKeys;
  const trailCleared =
    traveledHexKeys.length > 0 ? false : staged.trailCleared || loaded.trailCleared;

  return {
    ...staged,
    traveledHexKeys,
    trailCleared,
    hexAnnotations: loaded.hexAnnotations,
    hexCoverBaseline: loaded.hexCoverBaseline,
    hiddenTrailHexKeys: loaded.hiddenTrailHexKeys,
    showTerrainIcons: staged.showTerrainIcons,
    showHexCoords: staged.showHexCoords,
    mapDestination: staged.mapDestination,
  };
}
