import type {
  ItemCategoryRange,
  LootCategoryKey,
  ScavengerLocation,
} from "./ScavengerLocation.js";
import {
  getRollTableDisplayName,
  getScavengingRollTableStatus,
  resolveRollTableKey,
  type ScavengingRollTableStatusRow,
} from "./rollTableRegistry.js";

export function formatLootCategoryLabel(category: LootCategoryKey): string {
  if (category === "junk") return "Junk";
  if (category === "weapons") return "Weapons";
  const key = resolveRollTableKey(category);
  if (key) return getRollTableDisplayName(key);
  return category;
}

export type LootGridRow = {
  category: LootCategoryKey;
  label: string;
  min: number;
  max: number;
  installed: boolean;
  tableId?: string;
};

export async function buildPlayerLootRows(
  location: ScavengerLocation,
): Promise<LootGridRow[]> {
  const keys = location.items
    .map((item) => resolveRollTableKey(item.category))
    .filter((k): k is NonNullable<typeof k> => Boolean(k));
  const status = await getScavengingRollTableStatus([...new Set(keys)]);
  const statusByKey = new Map(status.tables.map((row) => [row.tableKey, row] as const));

  return location.items
    .filter((item) => item.category !== "junk")
    .map((item) => lootGridRowFromItem(item, statusByKey))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function lootGridRowFromItem(
  item: ItemCategoryRange,
  statusByKey: Map<string, ScavengingRollTableStatusRow>,
): LootGridRow {
  const tableKey = resolveRollTableKey(item.category);
  const label = formatLootCategoryLabel(item.category);
  const status = tableKey ? statusByKey.get(tableKey) : undefined;

  return {
    category: item.category,
    label,
    min: item.min,
    max: item.max,
    installed: status?.installed ?? false,
    tableId: status?.tableId,
  };
}
