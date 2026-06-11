import { t } from "../integrations/i18n.js";
import { getActiveLootSlots } from "./sceneLoot.js";
import type {
  ItemCategoryRange,
  LootCategoryKey,
  ScavengerLocation,
} from "./ScavengerLocation.js";
import { getLootRowCounts, isLootValueFilterEnabled } from "./lootValueCap.js";
import { findSceneRollTableForCategory } from "./sceneLootTables.js";
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
  rowCountHint?: string;
};

export async function buildPlayerLootRows(
  location: ScavengerLocation,
): Promise<LootGridRow[]> {
  const slots = getActiveLootSlots(location).filter((s) => s.category !== "junk");
  const keys = slots
    .map((slot) => resolveRollTableKey(slot.category))
    .filter((k): k is NonNullable<typeof k> => Boolean(k));
  const status = await getScavengingRollTableStatus([...new Set(keys)]);
  const statusByKey = new Map(status.tables.map((row) => [row.tableKey, row] as const));

  const rows = await Promise.all(
    slots.map((slot) => lootGridRowFromSlot(location, slot, statusByKey)),
  );
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

async function lootGridRowFromSlot(
  location: ScavengerLocation,
  slot: import("./sceneLoot.js").ActiveLootSlot,
  statusByKey: Map<string, ScavengingRollTableStatusRow>,
): Promise<LootGridRow> {
  const tableKey = slot.tableKey ?? resolveRollTableKey(slot.category);
  const label = slot.label ?? formatLootCategoryLabel(slot.category);
  const status = tableKey ? statusByKey.get(tableKey) : undefined;
  const sceneTable = slot.tableId
    ? undefined
    : findSceneRollTableForCategory(location, slot.category);
  const tableId = slot.tableId ?? sceneTable?.id;

  let rowCountHint: string | undefined;
  if (isLootValueFilterEnabled()) {
    const counts = await getLootRowCounts(location, slot.category);
    if (counts && counts.total > 0) {
      rowCountHint = t("WASTELANDER.Scavenging.Loot.RowCountHint", {
        eligible: counts.eligible,
        total: counts.total,
      });
    }
  }

  return {
    category: slot.category,
    label,
    min: slot.min,
    max: slot.max,
    installed: Boolean(tableId ?? status?.installed),
    tableId: tableId ?? status?.tableId,
    rowCountHint,
  };
}
