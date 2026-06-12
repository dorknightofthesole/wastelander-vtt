import { MODULE_ID } from "../constants.js";
import { currentUserIsOverseer } from "../integrations/overseerAccess.js";
import type { LootCategoryKey, ScavengerLocation } from "./ScavengerLocation.js";
import type { LootTableRow } from "./lootTableRanges.js";
import {
  getItemCapsFromUuid,
  getMaxCapsForLocationLevel,
  isRowEligibleByCaps,
  resolveRowCaps,
} from "./lootValueCap.js";
import {
  getItemRarityFromUuid,
  getMaxRarityForLocationLevel,
  isRowEligibleByRarity,
  resolveRowRarity,
} from "./lootRarity.js";
import { SCAVENGING_SETTINGS } from "./scavengingSettings.js";
import { collectTableResultRows } from "./rollTableLookup.js";
import {
  findRollTableByKey,
  resolveRollTableDocument,
  resolveWeaponSubcategory,
} from "./rollTableRegistry.js";
import { findSceneRollTableForCategory } from "./sceneLootTables.js";

export type LootFilterMode = "none" | "value" | "rarity";

const LOOT_FILTER_MODES = new Set<LootFilterMode>(["none", "value", "rarity"]);

export function normalizeLootFilterMode(raw: unknown): LootFilterMode {
  if (typeof raw === "string" && LOOT_FILTER_MODES.has(raw as LootFilterMode)) {
    return raw as LootFilterMode;
  }
  return "none";
}

export function getLootFilterMode(): LootFilterMode {
  const stored = game.settings.get(MODULE_ID, SCAVENGING_SETTINGS.lootFilterMode) as unknown;
  return normalizeLootFilterMode(stored);
}

export function isLootFilterActive(): boolean {
  return getLootFilterMode() !== "none";
}

export function isLootValueFilterEnabled(): boolean {
  return getLootFilterMode() === "value";
}

export function isLootRarityFilterEnabled(): boolean {
  return getLootFilterMode() === "rarity";
}

/** Migrate legacy boolean setting to lootFilterMode (once per world). */
export async function migrateLegacyLootFilterSetting(): Promise<void> {
  if (!currentUserIsOverseer()) return;

  const legacyEnabled = Boolean(
    game.settings.get(MODULE_ID, SCAVENGING_SETTINGS.lootValueFilterEnabled),
  );
  if (!legacyEnabled) return;

  const currentMode = game.settings.get(MODULE_ID, SCAVENGING_SETTINGS.lootFilterMode);
  if (currentMode == null || currentMode === "" || currentMode === "none") {
    await game.settings.set(MODULE_ID, SCAVENGING_SETTINGS.lootFilterMode, "value");
  }

  // Clear legacy flag so explicit "none" / "rarity" is not overwritten on reload.
  await game.settings.set(MODULE_ID, SCAVENGING_SETTINGS.lootValueFilterEnabled, false);
}

export async function filterLootRowsForLocation(
  location: ScavengerLocation,
  rows: LootTableRow[],
): Promise<LootTableRow[]> {
  const mode = getLootFilterMode();
  if (mode === "none") return rows;

  if (mode === "value") {
    const maxCaps = getMaxCapsForLocationLevel(location.level);
    const eligible: LootTableRow[] = [];
    for (const row of rows) {
      const caps =
        row.caps ??
        (row.documentUuid ? await getItemCapsFromUuid(row.documentUuid) : null);
      if (isRowEligibleByCaps({ ...row, caps }, maxCaps)) {
        eligible.push({ ...row, caps });
      }
    }
    return eligible;
  }

  const maxRarity = getMaxRarityForLocationLevel(location.level);
  const eligible: LootTableRow[] = [];
  for (const row of rows) {
    const rarity =
      row.rarity ??
      (row.documentUuid ? await getItemRarityFromUuid(row.documentUuid) : null);
    if (isRowEligibleByRarity({ ...row, rarity }, maxRarity)) {
      eligible.push({ ...row, rarity });
    }
  }
  return eligible;
}

const WEAPON_TABLE_KEYS = [
  "weaponsRanged",
  "weaponsMelee",
  "weaponsThrown",
] as const satisfies readonly LootCategoryKey[];

function resolveTableCategory(category: LootCategoryKey): LootCategoryKey {
  return category === "weapons" ? resolveWeaponSubcategory() : category;
}

async function compendiumRowCount(tableKey: LootCategoryKey): Promise<number> {
  const found = findRollTableByKey(tableKey as never);
  if (!found) return 0;
  const table = await resolveRollTableDocument(found.ref);
  return table ? collectTableResultRows(table).length : 0;
}

async function isLootRowEligibleForFilter(
  row: LootTableRow,
  location: ScavengerLocation,
): Promise<boolean> {
  const mode = getLootFilterMode();
  if (mode === "none") return true;

  if (mode === "value") {
    const maxCaps = getMaxCapsForLocationLevel(location.level);
    const caps = await resolveRowCaps(row);
    if (caps == null) return true;
    return caps <= maxCaps;
  }

  const maxRarity = getMaxRarityForLocationLevel(location.level);
  const rarity = await resolveRowRarity(row);
  if (rarity == null) return true;
  return rarity <= maxRarity;
}

export async function getLootRowCounts(
  location: ScavengerLocation,
  category: LootCategoryKey,
): Promise<{ total: number; eligible: number } | null> {
  if (category === "junk") return null;

  const rollCategory = resolveTableCategory(category);
  const sceneTable = findSceneRollTableForCategory(location, rollCategory);
  const total = sceneTable
    ? collectTableResultRows(sceneTable).length
    : await compendiumRowCount(rollCategory);

  if (!total) return null;
  if (!isLootFilterActive()) {
    return { total, eligible: total };
  }

  if (category === "weapons") {
    let eligible = 0;
    for (const key of WEAPON_TABLE_KEYS) {
      const table = findSceneRollTableForCategory(location, key);
      const rows = table ? collectTableResultRows(table) : [];
      for (const row of rows) {
        const lootRow: LootTableRow = {
          range: row.range ?? [0, 0],
          name: row.name ?? "—",
          documentUuid: row.documentUuid,
          caps: null,
          rarity: null,
        };
        if (await isLootRowEligibleForFilter(lootRow, location)) eligible += 1;
      }
    }
    const weaponTotal = await Promise.all(
      WEAPON_TABLE_KEYS.map((key) => compendiumRowCount(key)),
    ).then((counts) => counts.reduce((sum, n) => sum + n, 0));
    return { total: weaponTotal || total, eligible };
  }

  const rows = sceneTable ? collectTableResultRows(sceneTable) : [];
  let eligible = 0;
  for (const row of rows) {
    const lootRow: LootTableRow = {
      range: row.range ?? [0, 0],
      name: row.name ?? "—",
      documentUuid: row.documentUuid,
      caps: null,
      rarity: null,
    };
    if (await isLootRowEligibleForFilter(lootRow, location)) eligible += 1;
  }
  return { total, eligible };
}
