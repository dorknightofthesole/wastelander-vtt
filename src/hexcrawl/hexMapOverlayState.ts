import type { HexcrawlSceneState } from "./hexcrawlScenePersist.js";

const stagedByScene = new Map<string, HexcrawlSceneState>();

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
  return {
    ...staged,
    hexAnnotations: loaded.hexAnnotations,
    hexCoverBaseline: loaded.hexCoverBaseline,
    hiddenTrailHexKeys: loaded.hiddenTrailHexKeys,
    showTerrainIcons: staged.showTerrainIcons,
    showHexCoords: staged.showHexCoords,
    mapDestination: staged.mapDestination,
  };
}
