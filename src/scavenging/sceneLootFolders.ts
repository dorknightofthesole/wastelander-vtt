import { ORACLE_ROOT_FOLDER } from "../oracle/oracleRollTableFolders.js";

/** RollTable sidebar: `Wastelander / Scenes / {scene name}`. */
export const SCENE_LOOT_ROOT_FOLDER = ORACLE_ROOT_FOLDER;
export const SCENE_LOOT_SCENES_SUBFOLDER = "Scenes";

export function sceneLootFolderSegments(sceneName: string): string[] {
  return [SCENE_LOOT_ROOT_FOLDER, SCENE_LOOT_SCENES_SUBFOLDER, sceneName.trim()];
}
