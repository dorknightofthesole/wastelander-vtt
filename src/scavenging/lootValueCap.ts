import bundledCapConfig from "../data/scavenging/loot/value-cap-by-level.json";
import { MODULE_ID } from "../constants.js";
import type { LootCategoryKey, ScavengerLocation } from "./ScavengerLocation.js";
import type { LootTableRow } from "./lootTableRanges.js";
import {
  getScavengingSettingBoolean,
  SCAVENGING_SETTINGS,
} from "./scavengingSettings.js";
import { collectTableResultRows } from "./rollTableLookup.js";
import {
  findRollTableByKey,
  resolveRollTableDocument,
  resolveRollTableKey,
  resolveWeaponSubcategory,
} from "./rollTableRegistry.js";
import { findSceneRollTableForCategory } from "./sceneLootTables.js";

export type LootValueCapBand = {
  maxLevel: number;
  maxCaps: number;
};

export type LootValueCapFormula = {
  base?: number;
  scale?: number;
  capCeiling?: number;
};

export type LootValueCapConfig = {
  bands?: LootValueCapBand[];
  formula?: LootValueCapFormula;
  /** Fallback for levels above the highest band; kept in sync with formula.capCeiling on save. */
  defaultMaxCaps?: number;
};

const DEFAULT_CONFIG = bundledCapConfig as LootValueCapConfig;

export function getDefaultLootValueCapFormula(): LootValueCapFormula {
  const formula = DEFAULT_CONFIG.formula ?? {};
  return {
    base: formula.base ?? 25,
    scale: formula.scale ?? 30,
    capCeiling: formula.capCeiling ?? 10_000,
  };
}

function normalizeLootValueCapFormula(raw: unknown): LootValueCapFormula {
  const defaults = getDefaultLootValueCapFormula();
  if (!raw || typeof raw !== "object") return { ...defaults };
  const input = raw as LootValueCapFormula;
  const out: LootValueCapFormula = { ...defaults };
  if (typeof input.base === "number" && Number.isFinite(input.base)) {
    out.base = Math.max(0, Math.floor(input.base));
  }
  if (typeof input.scale === "number" && Number.isFinite(input.scale)) {
    out.scale = Math.max(0, Math.floor(input.scale));
  }
  if (typeof input.capCeiling === "number" && Number.isFinite(input.capCeiling)) {
    out.capCeiling = Math.max(0, Math.floor(input.capCeiling));
  }
  return out;
}

/** Quadratic curve: base + scale × level², clamped to capCeiling. */
export function capsFromQuadraticFormula(
  level: number,
  formula: LootValueCapFormula,
): number {
  const base = formula.base ?? 25;
  const scale = formula.scale ?? 30;
  const ceiling = formula.capCeiling ?? 10_000;
  const lvl = Math.max(0, Math.floor(level));
  const raw = base + scale * lvl * lvl;
  return Math.min(ceiling, Math.max(0, Math.floor(raw)));
}

/** Recompute maxCaps for each band from its maxLevel using the quadratic formula. */
export function recalculateBandCapsFromFormula(
  bands: LootValueCapBand[],
  formula: LootValueCapFormula,
): LootValueCapBand[] {
  return bands.map((band) => ({
    maxLevel: band.maxLevel,
    maxCaps: capsFromQuadraticFormula(band.maxLevel, formula),
  }));
}

export function capsForLocationLevelFromConfig(
  level: number,
  config: LootValueCapConfig,
): number {
  const bands = config.bands ?? [];
  const lvl = Math.max(0, Math.floor(level));
  for (const band of bands) {
    if (lvl <= band.maxLevel) return band.maxCaps;
  }
  return config.defaultMaxCaps ?? bands.at(-1)?.maxCaps ?? 9999;
}

const itemCapsCache = new Map<string, number | null>();

export function getBundledLootValueCapConfig(): LootValueCapConfig {
  return foundry.utils.deepClone(DEFAULT_CONFIG);
}

export function normalizeLootValueCapConfig(raw: unknown): LootValueCapConfig {
  const base = getBundledLootValueCapConfig();
  if (!raw || typeof raw !== "object") return {};
  const input = raw as LootValueCapConfig;
  const bands = Array.isArray(input.bands)
    ? input.bands
        .map((band) => ({
          maxLevel: Math.max(0, Math.floor(Number(band.maxLevel))),
          maxCaps: Math.max(0, Math.floor(Number(band.maxCaps))),
        }))
        .filter((band) => Number.isFinite(band.maxLevel) && Number.isFinite(band.maxCaps))
        .sort((a, b) => a.maxLevel - b.maxLevel)
    : undefined;

  const out: LootValueCapConfig = {};
  if (bands?.length) out.bands = bands;
  if (typeof input.defaultMaxCaps === "number" && Number.isFinite(input.defaultMaxCaps)) {
    out.defaultMaxCaps = Math.max(0, Math.floor(input.defaultMaxCaps));
  }
  out.formula = normalizeLootValueCapFormula(input.formula ?? base.formula);

  if (!out.bands?.length) {
    out.bands = base.bands;
  }
  if (out.defaultMaxCaps === undefined) {
    out.defaultMaxCaps = out.formula?.capCeiling ?? base.defaultMaxCaps;
  }
  return out;
}

export function getLootValueCapConfig(): LootValueCapConfig {
  const stored = game.settings.get(MODULE_ID, SCAVENGING_SETTINGS.lootValueCapConfig) as unknown;
  if (!stored || typeof stored !== "object") {
    return getBundledLootValueCapConfig();
  }
  const normalized = normalizeLootValueCapConfig(stored);
  const hasWorldBands =
    Array.isArray((stored as LootValueCapConfig).bands) &&
    (stored as LootValueCapConfig).bands!.length > 0;
  if (!hasWorldBands) {
    return {
      ...getBundledLootValueCapConfig(),
      ...normalized,
      bands: getBundledLootValueCapConfig().bands,
    };
  }
  return normalized;
}

export function isLootValueFilterEnabled(): boolean {
  return getScavengingSettingBoolean(SCAVENGING_SETTINGS.lootValueFilterEnabled);
}

export function getMaxCapsForLocationLevel(level: number): number {
  return capsForLocationLevelFromConfig(level, getLootValueCapConfig());
}

function parseItemCostValue(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return null;
}

function readCostFromItemSystem(system: unknown): number | null {
  if (!system || typeof system !== "object") return null;
  const data = system as Record<string, unknown>;

  const fromCost = parseItemCostValue(data.cost);
  if (fromCost != null) return fromCost;

  const price = data.price;
  if (price && typeof price === "object") {
    const fromPrice = parseItemCostValue((price as { value?: unknown }).value);
    if (fromPrice != null) return fromPrice;
  }

  return null;
}

export async function getItemCapsFromUuid(uuid: string): Promise<number | null> {
  const key = uuid.trim();
  if (!key) return null;
  if (itemCapsCache.has(key)) return itemCapsCache.get(key)!;

  try {
    const doc = await fromUuid(key);
    const caps = readCostFromItemSystem(
      (doc as { system?: unknown } | null)?.system,
    );
    itemCapsCache.set(key, caps);
    return caps;
  } catch {
    itemCapsCache.set(key, null);
    return null;
  }
}

/** Resolve caps from the indexed row or by loading the linked item document. */
export async function resolveRowCaps(row: LootTableRow): Promise<number | null> {
  if (row.caps != null) return row.caps;
  const uuid = row.documentUuid?.trim();
  if (!uuid) return null;
  return getItemCapsFromUuid(uuid);
}

export function isRowEligible(row: LootTableRow, maxCaps: number): boolean {
  if (row.caps == null) return true;
  return row.caps <= maxCaps;
}

async function isRowEligibleForFilter(
  row: LootTableRow,
  maxCaps: number,
): Promise<boolean> {
  const caps = await resolveRowCaps(row);
  if (caps == null) return true;
  return caps <= maxCaps;
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
  if (!isLootValueFilterEnabled()) {
    return { total, eligible: total };
  }

  const maxCaps = getMaxCapsForLocationLevel(location.level);
  if (category === "weapons") {
    let eligible = 0;
    for (const key of WEAPON_TABLE_KEYS) {
      const table = findSceneRollTableForCategory(location, key);
      const rows = table ? collectTableResultRows(table) : [];
      for (const row of rows) {
        const uuid = row.documentUuid?.trim();
        const caps = uuid ? await getItemCapsFromUuid(uuid) : null;
        if (caps == null || caps <= maxCaps) eligible += 1;
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
    };
    if (await isRowEligibleForFilter(lootRow, maxCaps)) eligible += 1;
  }
  return { total, eligible };
}

/** Clear cached item prices (e.g. after compendium reload). */
export function clearItemCapsCache(): void {
  itemCapsCache.clear();
}
