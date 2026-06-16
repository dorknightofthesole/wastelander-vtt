let selectedHexKey: string | null = null;
let selectedSceneId: string | null = null;

export function getHexMapEditorSelection(sceneId: string): string | null {
  if (selectedSceneId !== sceneId) return null;
  return selectedHexKey;
}

export function setHexMapEditorSelectionState(
  sceneId: string | null,
  hexKey: string | null,
): void {
  selectedHexKey = hexKey;
  selectedSceneId = hexKey && sceneId ? sceneId : null;
}

export function clearHexMapEditorSelectionState(sceneId?: string): void {
  if (sceneId && selectedSceneId !== sceneId) return;
  selectedHexKey = null;
  selectedSceneId = null;
}
