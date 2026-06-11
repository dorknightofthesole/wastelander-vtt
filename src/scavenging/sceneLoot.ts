import type {
  ItemCategoryRange,
  LootCategoryKey,
  ScavengerLocation,
} from "./ScavengerLocation.js";
import {
  getRollTableDisplayName,
  getRollTableNameCandidates,
  resolveRollTableKey,
  type ScavengingRollTableKey,
} from "./rollTableRegistry.js";
import { refreshSceneLootSlotsFromFolder } from "./sceneLootTables.js";
import { MODULE_ID } from "../constants.js";
import { normalizeTableName } from "../integrations/rollTableDocuments.js";

export type SceneLootSlot = {
  tableId: string;
  tableKey?: ScavengingRollTableKey;
  min: number;
  max: number;
};

export type SceneLoot = {
  version: 1;
  folderId?: string;
  slots: SceneLootSlot[];
  /** Single scene weapon table when the location has an abstract `weapons` slot. */
  weaponsTableKey?: ScavengingRollTableKey;
};

export type ActiveLootSlot = {
  category: LootCategoryKey;
  min: number;
  max: number;
  tableKey?: ScavengingRollTableKey;
  tableId?: string;
  label?: string;
};

export const WASTELANDER_TABLE_FLAGS = `${MODULE_ID}`;

export type WastelanderTableFlags = {
  tableKey?: ScavengingRollTableKey;
  managedByModule?: boolean;
};

export function readWastelanderTableFlags(
  table: { flags?: Record<string, unknown> },
): WastelanderTableFlags {
  const raw = table.flags?.[WASTELANDER_TABLE_FLAGS];
  if (!raw || typeof raw !== "object") return {};
  const data = raw as WastelanderTableFlags;
  return {
    tableKey: data.tableKey,
    managedByModule: data.managedByModule === true,
  };
}

export function wastelanderTableFlagsPayload(
  tableKey: ScavengingRollTableKey,
  managedByModule = true,
): Record<string, unknown> {
  return {
    [WASTELANDER_TABLE_FLAGS]: {
      tableKey,
      managedByModule,
    },
  };
}

export function emptySceneLoot(): SceneLoot {
  return { version: 1, slots: [] };
}

export function normalizeSceneLoot(raw: unknown): SceneLoot | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const data = raw as Partial<SceneLoot>;
  if (!Array.isArray(data.slots)) return undefined;

  const slots: SceneLootSlot[] = [];
  for (const entry of data.slots) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Partial<SceneLootSlot>;
    const tableId = typeof row.tableId === "string" ? row.tableId.trim() : "";
    if (!tableId) continue;
    slots.push({
      tableId,
      tableKey:
        typeof row.tableKey === "string"
          ? (row.tableKey as ScavengingRollTableKey)
          : undefined,
      min: Math.max(0, Math.floor(Number(row.min) || 0)),
      max: Math.max(0, Math.floor(Number(row.max) || 0)),
    });
  }

  const weaponsTableKey =
    typeof data.weaponsTableKey === "string" &&
    (data.weaponsTableKey === "weaponsRanged" ||
      data.weaponsTableKey === "weaponsMelee" ||
      data.weaponsTableKey === "weaponsThrown")
      ? data.weaponsTableKey
      : undefined;

  return {
    version: 1,
    folderId: typeof data.folderId === "string" ? data.folderId : undefined,
    slots,
    weaponsTableKey,
  };
}

export function hasSceneLootFolder(
  location: ScavengerLocation | null | undefined,
): boolean {
  return Boolean(location?.sceneLoot?.folderId);
}

export function hasLegacyLootData(location: ScavengerLocation | null | undefined): boolean {
  if (!location) return false;
  const loc = location as ScavengerLocation & {
    lootTableIndex?: unknown;
    customLoot?: unknown;
  };
  return Boolean(loc.lootTableIndex || loc.customLoot);
}

export function inferTableKeyFromName(name: string): ScavengingRollTableKey | undefined {
  const target = normalizeTableName(name);
  const keys = [
    "ammunition",
    "armor",
    "clothing",
    "food",
    "beverages",
    "chems",
    "oddities",
    "weaponsRanged",
    "weaponsMelee",
    "weaponsThrown",
    "otherFoundItems",
  ] as ScavengingRollTableKey[];

  for (const tableKey of keys) {
    for (const candidate of getRollTableNameCandidates(tableKey)) {
      if (normalizeTableName(candidate) === target) return tableKey;
    }
  }
  return undefined;
}

export function resolveTableKeyForRollTable(
  table: { id: string; name: string; flags?: Record<string, unknown> },
): ScavengingRollTableKey | undefined {
  const fromFlags = readWastelanderTableFlags(table).tableKey;
  if (fromFlags) return fromFlags;
  return inferTableKeyFromName(table.name);
}

function slotCategoryForTableKey(
  tableKey: ScavengingRollTableKey,
): LootCategoryKey {
  if (
    tableKey === "weaponsRanged" ||
    tableKey === "weaponsMelee" ||
    tableKey === "weaponsThrown"
  ) {
    return tableKey;
  }
  return tableKey as LootCategoryKey;
}

function defaultMinMaxForTableKey(
  location: ScavengerLocation,
  tableKey: ScavengingRollTableKey,
): { min: number; max: number } {
  if (
    tableKey === "weaponsRanged" ||
    tableKey === "weaponsMelee" ||
    tableKey === "weaponsThrown"
  ) {
    const weapons = location.items.find((i) => i.category === "weapons");
    return weapons
      ? { min: weapons.min, max: weapons.max }
      : { min: 0, max: 0 };
  }
  const category = tableKey as LootCategoryKey;
  const item = location.items.find((i) => i.category === category);
  return item ? { min: item.min, max: item.max } : { min: 0, max: 0 };
}

export function getSceneLootSlot(
  location: ScavengerLocation,
  tableId: string,
): SceneLootSlot | undefined {
  return location.sceneLoot?.slots.find((slot) => slot.tableId === tableId);
}

export function upsertSceneLootSlot(
  location: ScavengerLocation,
  slot: SceneLootSlot,
): ScavengerLocation {
  const sceneLoot = location.sceneLoot ?? emptySceneLoot();
  const slots = sceneLoot.slots.filter((row) => row.tableId !== slot.tableId);
  slots.push(slot);
  return {
    ...location,
    sceneLoot: { ...sceneLoot, slots },
  };
}

const WEAPON_TABLE_KEYS = new Set<ScavengingRollTableKey>([
  "weaponsRanged",
  "weaponsMelee",
  "weaponsThrown",
]);

export function getActiveLootSlots(location: ScavengerLocation): ActiveLootSlot[] {
  const slots: ActiveLootSlot[] = [];
  const syncedLocation = location.sceneLoot?.folderId
    ? refreshSceneLootSlotsFromFolder(location)
    : location;
  const sceneLoot = syncedLocation.sceneLoot;

  if (sceneLoot?.slots.length) {
    for (const slot of sceneLoot.slots) {
      if (slot.max <= 0 && slot.min <= 0) continue;

      const tableKey = slot.tableKey;
      if (tableKey && WEAPON_TABLE_KEYS.has(tableKey)) {
        slots.push({
          category: tableKey as LootCategoryKey,
          min: slot.min,
          max: slot.max,
          tableKey,
          tableId: slot.tableId,
          label: getRollTableDisplayName(tableKey),
        });
        continue;
      }

      if (tableKey) {
        slots.push({
          category: slotCategoryForTableKey(tableKey),
          min: slot.min,
          max: slot.max,
          tableKey,
          tableId: slot.tableId,
          label: getRollTableDisplayName(tableKey),
        });
        continue;
      }

      slots.push({
        category: "oddities",
        min: slot.min,
        max: slot.max,
        tableId: slot.tableId,
        label: undefined,
      });
    }
  } else {
    for (const item of syncedLocation.items) {
      if (item.category === "junk") continue;
      slots.push({
        category: item.category,
        min: item.min,
        max: item.max,
        tableKey: resolveRollTableKey(item.category) ?? undefined,
      });
    }
  }

  const junk = syncedLocation.items.find((i) => i.category === "junk");
  if (junk) {
    slots.push({ category: "junk", min: junk.min, max: junk.max });
  }

  return slots.sort((a, b) => formatSlotLabel(a).localeCompare(formatSlotLabel(b)));
}

function formatSlotLabel(slot: ActiveLootSlot): string {
  if (slot.label) return slot.label;
  if (slot.tableKey) return getRollTableDisplayName(slot.tableKey);
  if (slot.category === "junk") return "Junk";
  if (slot.category === "weapons") return "Weapons";
  const key = resolveRollTableKey(slot.category);
  return key ? getRollTableDisplayName(key) : slot.category;
}

export function getActiveItemRange(
  location: ScavengerLocation,
  category: LootCategoryKey,
): ItemCategoryRange | undefined {
  const slot = getActiveLootSlots(location).find((s) => s.category === category);
  if (!slot) return undefined;
  return { category: slot.category, min: slot.min, max: slot.max };
}

export function defaultMinMaxForNewTable(
  location: ScavengerLocation,
  tableKey: ScavengingRollTableKey | undefined,
): { min: number; max: number } {
  if (!tableKey) return { min: 0, max: 0 };
  return defaultMinMaxForTableKey(location, tableKey);
}
