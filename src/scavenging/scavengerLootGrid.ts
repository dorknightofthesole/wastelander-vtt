import { getActiveLootSlots } from "./sceneLoot.js";
import { formatLootCategoryLabel } from "./lootGrid.js";
import { findSceneRollTableForCategory } from "./sceneLootTables.js";
import type { ScavengerLocation } from "./ScavengerLocation.js";
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

  return getActiveLootSlots(location)
    .map((slot) => {
      const tableKey = slot.tableKey ?? resolveRollTableKey(slot.category);
      const label = slot.label ?? formatLootCategoryLabel(slot.category);
      const sceneTable =
        slot.tableId
          ? undefined
          : tableKey
            ? findSceneRollTableForCategory(location, slot.category)
            : undefined;
      const tableId = slot.tableId ?? sceneTable?.id;
      const status = tableKey ? statusByKey.get(tableKey) : undefined;

      return {
        label,
        min: String(slot.min),
        max: String(slot.max),
        installed: Boolean(tableId ?? status?.installed),
        tableId: tableId ?? status?.tableId,
        resultCount: sceneTable?.results?.length ?? status?.resultCount,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
