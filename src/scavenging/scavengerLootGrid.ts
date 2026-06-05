import type { ItemCategoryRange, ScavengerLocation } from "./ScavengerLocation.js";
import { formatLootCategoryLabel } from "./lootGrid.js";
import {
  resolveRollTableKey,
  type ScavengingRollTableStatusRow,
} from "./rollTableRegistry.js";

export type ScavengerLootGridRow = {
  label: string;
  min: string;
  max: string;
  installed: boolean;
  tableId?: string;
  resultCount?: number;
};

export function buildScavengerLootGridRows(
  location: ScavengerLocation | null,
  statusRows: ScavengingRollTableStatusRow[],
): ScavengerLootGridRow[] {
  const statusByKey = new Map(
    statusRows.map((row) => [row.tableKey, row] as const),
  );

  if (!location) {
    return statusRows.map((row) => ({
      label: row.name,
      min: "—",
      max: "—",
      installed: row.installed,
      tableId: row.tableId,
      resultCount: row.resultCount,
    }));
  }

  return location.items
    .map((item) => lootGridRowFromItem(item, statusByKey))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function lootGridRowFromItem(
  item: ItemCategoryRange,
  statusByKey: Map<string, ScavengingRollTableStatusRow>,
): ScavengerLootGridRow {
  const tableKey = resolveRollTableKey(item.category);
  const label = formatLootCategoryLabel(item.category);
  const status = tableKey ? statusByKey.get(tableKey) : undefined;

  return {
    label,
    min: String(item.min),
    max: String(item.max),
    installed: status?.installed ?? false,
    tableId: status?.tableId,
    resultCount: status?.resultCount,
  };
}
