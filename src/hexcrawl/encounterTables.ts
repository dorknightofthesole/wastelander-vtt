import {
  clearRollTableFolderCache,
  ensureRollTableFolder,
  findWorldRollTableByName,
} from "../integrations/rollTableDocuments.js";
import {
  ENCOUNTER_ROOT_FOLDER,
  ENCOUNTER_SUBFOLDER,
} from "../encounters/encounterRollTableFolders.js";
import {
  ENCOUNTER_TABLE_BY_TYPE,
  ENCOUNTER_TYPE_TABLE,
} from "./travelRules.js";

let cachedFolderId: string | undefined;

export async function resolveEncountersFolderId(): Promise<string | undefined> {
  if (cachedFolderId) return cachedFolderId;
  clearRollTableFolderCache();
  const rootId = await ensureRollTableFolder(ENCOUNTER_ROOT_FOLDER, null);
  if (!rootId) return undefined;
  cachedFolderId = await ensureRollTableFolder(ENCOUNTER_SUBFOLDER, rootId);
  return cachedFolderId;
}

export function clearEncounterTableCache(): void {
  cachedFolderId = undefined;
}

export async function findEncounterTableByName(
  name: string,
): Promise<RollTable | undefined> {
  const folderId = await resolveEncountersFolderId();
  if (!folderId) return undefined;
  return findWorldRollTableByName(name, folderId);
}

export async function findEncounterTypeTable(): Promise<RollTable | undefined> {
  return findEncounterTableByName(ENCOUNTER_TYPE_TABLE);
}

export async function findEncounterTableForType(
  encounterType: string,
): Promise<RollTable | undefined> {
  const tableName = ENCOUNTER_TABLE_BY_TYPE[encounterType.trim()];
  if (!tableName) return undefined;
  return findEncounterTableByName(tableName);
}
