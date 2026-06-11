import { MODULE_ID } from "../constants.js";
import {
  deleteRollTablesInFolder,
  ensureRollTableFolder,
  ensureRollTableFolderTree,
  findRollTableFolder,
  findRollTableFolderByFlag,
  getRollTableDocument,
  listRollTablesInFolder,
  type RollTableResultPayload,
  upsertRollTableInFolder,
} from "../integrations/rollTableDocuments.js";
import type { LootCategoryKey, ScavengerLocation } from "./ScavengerLocation.js";
import { suggestRollFormula, type LootTableRow } from "./lootTableRanges.js";
import {
  getItemCapsFromUuid,
  getMaxCapsForLocationLevel,
  isLootValueFilterEnabled,
} from "./lootValueCap.js";
import {
  loadRollTableResultRows,
  type TableResultRow,
} from "./rollTableLookup.js";
import {
  categoryUsesRollTable,
  findRollTableByKey,
  getRollTableDisplayName,
  resolveRollTableDocument,
  resolveWeaponSubcategory,
  type ScavengingRollTableKey,
} from "./rollTableRegistry.js";
import {
  SCENE_LOOT_ROOT_FOLDER,
  SCENE_LOOT_SCENES_SUBFOLDER,
} from "./sceneLootFolders.js";
import {
  defaultMinMaxForNewTable,
  emptySceneLoot,
  getSceneLootSlot,
  normalizeSceneLoot,
  readWastelanderTableFlags,
  resolveTableKeyForRollTable,
  type SceneLoot,
  type SceneLootSlot,
  wastelanderTableFlagsPayload as buildFlags,
} from "./sceneLoot.js";

const WEAPON_TABLE_KEYS: ScavengingRollTableKey[] = [
  "weaponsRanged",
  "weaponsMelee",
  "weaponsThrown",
];

function isWeaponSubcategory(
  key: LootCategoryKey,
): key is (typeof WEAPON_TABLE_KEYS)[number] {
  return WEAPON_TABLE_KEYS.includes(key as (typeof WEAPON_TABLE_KEYS)[number]);
}

/** Roll-table keys to materialize under this scene folder (location booklet only). */
export function resolveSceneLootTableKeys(location: ScavengerLocation): {
  keys: ScavengingRollTableKey[];
  weaponsTableKey?: ScavengingRollTableKey;
} {
  const keys = new Set<ScavengingRollTableKey>();
  let needsAbstractWeaponsTable = false;

  const addCategory = (category: LootCategoryKey) => {
    if (!categoryUsesRollTable(category)) return;
    if (category === "weapons") {
      needsAbstractWeaponsTable = true;
      return;
    }
    if (isWeaponSubcategory(category)) {
      keys.add(category);
      return;
    }
    keys.add(category as ScavengingRollTableKey);
  };

  for (const item of location.items) addCategory(item.category);
  for (const other of location.otherFoundRolls ?? []) addCategory(other.category);

  let weaponsTableKey = location.sceneLoot?.weaponsTableKey;
  if (needsAbstractWeaponsTable && !WEAPON_TABLE_KEYS.some((key) => keys.has(key))) {
    if (!weaponsTableKey || !isWeaponSubcategory(weaponsTableKey)) {
      const picked = resolveWeaponSubcategory();
      weaponsTableKey = isWeaponSubcategory(picked) ? picked : "weaponsRanged";
    }
    keys.add(weaponsTableKey);
  }

  return { keys: [...keys], weaponsTableKey };
}

function rowFromTableResult(
  row: TableResultRow,
  caps: number | null,
): LootTableRow | null {
  const range = row.range;
  if (!range || range.length < 2) return null;
  const min = Math.min(range[0]!, range[1]!);
  const max = Math.max(range[0]!, range[1]!);
  const name = row.name?.trim() || row.text?.trim() || "—";
  const documentUuid = row.documentUuid?.trim() || undefined;
  return {
    range: [min, max],
    name,
    documentUuid,
    caps,
  };
}

async function snapshotCategoryRows(
  tableKey: ScavengingRollTableKey,
): Promise<LootTableRow[]> {
  const tableRows = await loadRollTableResultRows(tableKey);
  if (!tableRows?.length) return [];

  const out: LootTableRow[] = [];
  for (const row of tableRows) {
    const uuid = row.documentUuid?.trim();
    const caps = uuid ? await getItemCapsFromUuid(uuid) : null;
    const mapped = rowFromTableResult(row, caps);
    if (mapped) out.push(mapped);
  }
  return out;
}

async function filterRowsForLocation(
  location: ScavengerLocation,
  rows: LootTableRow[],
): Promise<LootTableRow[]> {
  if (!isLootValueFilterEnabled()) return rows;
  const maxCaps = getMaxCapsForLocationLevel(location.level);
  const eligible: LootTableRow[] = [];
  for (const row of rows) {
    const caps = row.caps ?? (row.documentUuid ? await getItemCapsFromUuid(row.documentUuid) : null);
    if (caps == null || caps <= maxCaps) {
      eligible.push({ ...row, caps });
    }
  }
  return eligible;
}

async function compendiumFormulaForKey(
  tableKey: ScavengingRollTableKey,
): Promise<string> {
  const found = findRollTableByKey(tableKey);
  if (!found) return suggestRollFormula(0, tableKey);
  const table = await resolveRollTableDocument(found.ref);
  const formula = table?.formula?.trim();
  if (formula) return formula;
  const rowCount = table ? (table.results?.length ?? 0) : 0;
  return suggestRollFormula(rowCount, tableKey);
}

function lootRowsToResultPayload(rows: LootTableRow[]): RollTableResultPayload[] {
  return rows.map((row) => ({
    type: row.documentUuid ? "document" : "text",
    name: row.name,
    range: row.range,
    documentUuid: row.documentUuid ?? null,
  }));
}

async function buildRowsForSceneTable(
  location: ScavengerLocation,
  tableKey: ScavengingRollTableKey,
): Promise<{ rows: LootTableRow[]; formula: string }> {
  const sourceRows = await snapshotCategoryRows(tableKey);
  const filtered = await filterRowsForLocation(location, sourceRows);
  const formula = await compendiumFormulaForKey(tableKey);
  // Keep compendium row ranges; filtered-out items leave gaps on the table.
  return { rows: filtered, formula };
}

async function ensurePlayerCanDraw(table: RollTable): Promise<void> {
  if (!game.user?.isGM) return;
  const def = Number(table.ownership?.default ?? 0);
  if (def >= 1) return;
  await table.update(
    {
      ownership: {
        ...(table.ownership as Record<string, number>),
        default: 1,
      },
    },
    { render: false },
  );
}

function findSceneTableByKey(
  location: ScavengerLocation,
  folderId: string,
  tableKey: ScavengingRollTableKey,
): RollTable | undefined {
  const slot = location.sceneLoot?.slots.find((row) => row.tableKey === tableKey);
  if (slot?.tableId) {
    const byId = getRollTableDocument(slot.tableId);
    if (byId) return byId;
  }

  for (const table of listRollTablesInFolder(folderId)) {
    const flags = readWastelanderTableFlags(table);
    if (flags.tableKey === tableKey) return table;
  }
  const displayName = getRollTableDisplayName(tableKey);
  return listRollTablesInFolder(folderId).find(
    (table) => table.name.trim() === displayName,
  );
}

export function resolveSceneLootFolderId(
  location: ScavengerLocation,
  sceneIdOverride?: string,
): string | undefined {
  const stored = location.sceneLoot?.folderId;
  const sceneId = sceneIdOverride ?? location.sceneId;

  if (stored) {
    const folder = (game as { folders?: { get?: (id: string) => Folder } }).folders?.get?.(
      stored,
    );
    if (folder?.type === "RollTable") {
      const boundSceneId = readSceneIdFromFolder(folder);
      if (boundSceneId && sceneId && boundSceneId === sceneId) return stored;
      if (listRollTablesInFolder(stored).length > 0) return stored;
    }
  }

  if (!sceneId) return stored;

  const wastelanderId = findRollTableFolder(SCENE_LOOT_ROOT_FOLDER, null)?.id;
  if (!wastelanderId) return stored;
  const scenesParentId = findRollTableFolder(
    SCENE_LOOT_SCENES_SUBFOLDER,
    wastelanderId,
  )?.id;
  if (!scenesParentId) return stored;

  const bound = findSceneLootFolderBySceneId(scenesParentId, sceneId);
  return bound?.id ?? stored;
}

async function createSceneTableIfMissing(
  location: ScavengerLocation,
  folderId: string,
  tableKey: ScavengingRollTableKey,
): Promise<RollTable | undefined> {
  const existing = findSceneTableByKey(location, folderId, tableKey);
  if (existing) {
    await ensurePlayerCanDraw(existing);
    return existing;
  }

  const { rows, formula } = await buildRowsForSceneTable(location, tableKey);
  if (!rows.length) return undefined;

  return upsertRollTableInFolder({
    name: getRollTableDisplayName(tableKey),
    folderId,
    formula,
    results: lootRowsToResultPayload(rows),
    flags: buildFlags(tableKey),
    folderOnly: true,
  });
}

function mergeSlotsFromFolder(
  location: ScavengerLocation,
  folderId: string,
): SceneLootSlot[] {
  const tables = listRollTablesInFolder(folderId);
  const existing = new Map(
    (location.sceneLoot?.slots ?? []).map((slot) => [slot.tableId, slot] as const),
  );
  const slots: SceneLootSlot[] = [];

  for (const table of tables) {
    const tableKey = resolveTableKeyForRollTable(table);
    const prior = existing.get(table.id);
    if (prior) {
      slots.push({
        ...prior,
        tableKey: prior.tableKey ?? tableKey,
      });
      continue;
    }
    const defaults = defaultMinMaxForNewTable(location, tableKey);
    slots.push({
      tableId: table.id,
      tableKey,
      min: defaults.min,
      max: defaults.max,
    });
  }

  return slots;
}

function readSceneIdFromFolder(folder: Folder): string | undefined {
  const moduleFlags = (folder.flags as Record<string, Record<string, unknown>>)?.wastelander;
  const sceneId = moduleFlags?.sceneId;
  return typeof sceneId === "string" ? sceneId : undefined;
}

function findSceneLootFolderBySceneId(
  scenesParentId: string,
  sceneId: string,
): Folder | undefined {
  return findRollTableFolderByFlag(scenesParentId, MODULE_ID, "sceneId", sceneId);
}

export function resolveSceneFolderName(
  sceneName: string,
  sceneId: string,
  scenesParentId: string,
): string {
  const bound = findSceneLootFolderBySceneId(scenesParentId, sceneId);
  if (bound) return bound.name;

  const base = sceneName.trim() || "Unnamed Scene";
  const existing = findRollTableFolder(base, scenesParentId);
  if (existing) {
    const boundSceneId = readSceneIdFromFolder(existing);
    if (!boundSceneId || boundSceneId === sceneId) return existing.name;
  }

  if (existing && readSceneIdFromFolder(existing) !== sceneId) {
    return `${base} (${sceneId.slice(-6)})`;
  }

  return base;
}

async function bindSceneIdOnFolder(folder: Folder, sceneId: string): Promise<void> {
  const flags = (folder.flags ?? {}) as Record<string, unknown>;
  const moduleFlags = (flags.wastelander ?? {}) as Record<string, unknown>;
  if (moduleFlags.sceneId === sceneId) return;
  await folder.update({
    flags: {
      ...flags,
      wastelander: { ...moduleFlags, sceneId },
    },
  });
}

async function ensureSceneLootFolder(
  sceneId: string,
  sceneName: string,
  existingFolderId?: string,
): Promise<string | undefined> {
  const wastelanderId = await ensureRollTableFolder(SCENE_LOOT_ROOT_FOLDER, null);
  if (!wastelanderId) return undefined;

  const scenesParentId = await ensureRollTableFolder(
    SCENE_LOOT_SCENES_SUBFOLDER,
    wastelanderId,
  );
  if (!scenesParentId) return undefined;

  if (existingFolderId) {
    const storedFolder = (game as { folders?: { get?: (id: string) => Folder } }).folders?.get?.(
      existingFolderId,
    );
    if (storedFolder?.type === "RollTable") {
      const boundSceneId = readSceneIdFromFolder(storedFolder);
      if (boundSceneId === sceneId) {
        await bindSceneIdOnFolder(storedFolder, sceneId);
        return existingFolderId;
      }
    }
  }

  const bound = findSceneLootFolderBySceneId(scenesParentId, sceneId);
  if (bound) {
    await bindSceneIdOnFolder(bound, sceneId);
    return bound.id;
  }

  const folderName = resolveSceneFolderName(sceneName, sceneId, scenesParentId);
  const existingByName = findRollTableFolder(folderName, scenesParentId);
  if (existingByName) {
    await bindSceneIdOnFolder(existingByName, sceneId);
    return existingByName.id;
  }

  const folderId = await ensureRollTableFolder(folderName, scenesParentId);
  if (!folderId) return undefined;

  const created = (game as { folders?: { get?: (id: string) => Folder } }).folders?.get?.(
    folderId,
  );
  if (created) await bindSceneIdOnFolder(created, sceneId);

  return folderId;
}

export type SyncSceneLootMode = "generate" | "reset";

export async function syncSceneLootTables(
  location: ScavengerLocation,
  sceneId: string,
  sceneName: string,
  mode: SyncSceneLootMode,
): Promise<ScavengerLocation> {
  if (!game.user?.isGM) return location;

  const folderId = await ensureSceneLootFolder(
    sceneId,
    sceneName,
    location.sceneLoot?.folderId,
  );
  if (!folderId) return location;

  if (mode === "reset") {
    await deleteRollTablesInFolder(folderId);
  }

  const { keys, weaponsTableKey } = resolveSceneLootTableKeys(location);
  for (const tableKey of keys) {
    if (mode === "generate") {
      const existing = findSceneTableByKey(location, folderId, tableKey);
      if (existing) {
        await ensurePlayerCanDraw(existing);
        continue;
      }
    }
    await createSceneTableIfMissing(location, folderId, tableKey);
  }

  for (const table of listRollTablesInFolder(folderId)) {
    await ensurePlayerCanDraw(table);
  }

  const slots = mergeSlotsFromFolder(location, folderId);
  const sceneLoot: SceneLoot = {
    version: 1,
    folderId,
    slots,
    weaponsTableKey,
  };

  return { ...location, sceneLoot };
}

export async function resetSceneLootTables(
  location: ScavengerLocation,
  sceneId: string,
  sceneName: string,
): Promise<ScavengerLocation> {
  return syncSceneLootTables(location, sceneId, sceneName, "reset");
}

export function findSceneRollTableForCategory(
  location: ScavengerLocation,
  category: LootCategoryKey,
): RollTable | undefined {
  let tableKey: ScavengingRollTableKey | null = null;
  if (category === "weapons" && location.sceneLoot?.weaponsTableKey) {
    tableKey = location.sceneLoot.weaponsTableKey;
  } else if (isWeaponSubcategory(category)) {
    tableKey = category;
  } else if (categoryUsesRollTable(category) && category !== "weapons") {
    tableKey = category as ScavengingRollTableKey;
  }
  if (!tableKey) return undefined;

  const slot = location.sceneLoot?.slots.find((row) => row.tableKey === tableKey);
  if (slot?.tableId) {
    const byId = getRollTableDocument(slot.tableId);
    if (byId) return byId;
  }

  const folderId = resolveSceneLootFolderId(location);
  if (!folderId) return undefined;

  return findSceneTableByKey(location, folderId, tableKey);
}

export function findSceneRollTableById(
  location: ScavengerLocation,
  tableId: string,
): RollTable | undefined {
  const byId = getRollTableDocument(tableId);
  if (byId) return byId;

  const folderId = resolveSceneLootFolderId(location);
  if (!folderId) return undefined;
  return listRollTablesInFolder(folderId).find((table) => table.id === tableId);
}

export function listSceneLootTables(location: ScavengerLocation): RollTable[] {
  const folderId = resolveSceneLootFolderId(location);
  if (!folderId) return [];
  return listRollTablesInFolder(folderId);
}

export function updateSceneLootSlotMinMax(
  location: ScavengerLocation,
  tableId: string,
  field: "min" | "max",
  value: number,
): ScavengerLocation {
  const sceneLoot = location.sceneLoot ?? emptySceneLoot();
  const slots = sceneLoot.slots.map((slot) => {
    if (slot.tableId !== tableId) return slot;
    return { ...slot, [field]: Math.max(0, Math.floor(value)) };
  });

  if (!slots.some((slot) => slot.tableId === tableId)) {
    const table = findSceneRollTableById(location, tableId);
    const tableKey = table ? resolveTableKeyForRollTable(table) : undefined;
    const defaults = defaultMinMaxForNewTable(location, tableKey);
    slots.push({
      tableId,
      tableKey,
      min: field === "min" ? Math.max(0, Math.floor(value)) : defaults.min,
      max: field === "max" ? Math.max(0, Math.floor(value)) : defaults.max,
    });
  }

  return {
    ...location,
    sceneLoot: { ...sceneLoot, slots },
  };
}

export function refreshSceneLootSlotsFromFolder(
  location: ScavengerLocation,
): ScavengerLocation {
  const folderId = resolveSceneLootFolderId(location);
  if (!folderId) return location;
  return {
    ...location,
    sceneLoot: {
      version: 1,
      folderId,
      slots: mergeSlotsFromFolder(location, folderId),
      weaponsTableKey: location.sceneLoot?.weaponsTableKey,
    },
  };
}

export { normalizeSceneLoot, getSceneLootSlot };
