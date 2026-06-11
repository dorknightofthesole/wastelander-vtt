import { t } from "../integrations/i18n.js";
import {
  hasLegacyLootData,
  hasSceneLootFolder,
  resolveTableKeyForRollTable,
} from "./sceneLoot.js";
import {
  getMaxCapsForLocationLevel,
  isLootValueFilterEnabled,
} from "./lootValueCap.js";
import type { ScavengerLocation } from "./ScavengerLocation.js";
import { collectTableResultRows } from "./rollTableLookup.js";
import {
  listSceneLootTables,
  refreshSceneLootSlotsFromFolder,
} from "./sceneLootTables.js";

export type LootTableTabPanel = {
  tableId: string;
  label: string;
  min: number;
  max: number;
  rollFormula: string;
  rowCount: number;
};

export type LootTablesTabContext = {
  empty: boolean;
  legacyUpgrade: boolean;
  filterEnabled: boolean;
  maxCaps?: number;
  filterBanner?: string;
  hint?: string;
  tables: LootTableTabPanel[];
};

export async function buildLootTablesTabContext(
  location: ScavengerLocation | null,
  _sceneId: string | null,
): Promise<LootTablesTabContext> {
  if (!location) {
    return {
      empty: true,
      legacyUpgrade: false,
      filterEnabled: isLootValueFilterEnabled(),
      hint: t("WASTELANDER.Scavenging.LootTables.NoLocation"),
      tables: [],
    };
  }

  const filterEnabled = isLootValueFilterEnabled();
  const legacyUpgrade = hasLegacyLootData(location) && !hasSceneLootFolder(location);

  if (legacyUpgrade) {
    return {
      empty: false,
      legacyUpgrade: true,
      filterEnabled,
      hint: t("WASTELANDER.Scavenging.LootTables.LegacyUpgrade"),
      tables: [],
    };
  }

  const refreshed = refreshSceneLootSlotsFromFolder(location);
  const worldTables = listSceneLootTables(refreshed);
  const slotById = new Map(
    (refreshed.sceneLoot?.slots ?? []).map((slot) => [slot.tableId, slot] as const),
  );

  const tables: LootTableTabPanel[] = worldTables.map((table) => {
    const slot = slotById.get(table.id);
    const tableKey = resolveTableKeyForRollTable(table);
    void tableKey;
    return {
      tableId: table.id,
      label: table.name,
      min: slot?.min ?? 0,
      max: slot?.max ?? 0,
      rollFormula: table.formula?.trim() || "2d20",
      rowCount: collectTableResultRows(table).length,
    };
  });

  tables.sort((a, b) => a.label.localeCompare(b.label));

  const maxCaps = getMaxCapsForLocationLevel(refreshed.level);

  return {
    empty: false,
    legacyUpgrade: false,
    filterEnabled,
    maxCaps: filterEnabled ? maxCaps : undefined,
    filterBanner: filterEnabled
      ? t("WASTELANDER.Scavenging.LootTables.FilterBanner", { maxCaps })
      : undefined,
    hint: t("WASTELANDER.Scavenging.LootTables.FoundryEditHint"),
    tables,
  };
}
