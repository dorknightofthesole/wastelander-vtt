/** RollTable sidebar: `Wastelander / Scenes / {scene name}`. */
export const SCENE_LOOT_ROOT_FOLDER = "Wastelander";
export const SCENE_LOOT_SCENES_SUBFOLDER = "Scenes";

export function sceneLootFolderSegments(sceneName: string): string[] {
  return [SCENE_LOOT_ROOT_FOLDER, SCENE_LOOT_SCENES_SUBFOLDER, sceneName.trim()];
}
