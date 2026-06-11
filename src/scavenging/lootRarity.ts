import bundledRarityConfig from "../data/scavenging/loot/rarity-by-level.json";
import { MODULE_ID } from "../constants.js";
import type { LootTableRow } from "./lootTableRanges.js";
import { SCAVENGING_SETTINGS } from "./scavengingSettings.js";

export type LootRarityBand = {
  maxLevel: number;
  maxRarity: number;
};

export type LootRarityFormula = {
  perLevel?: number;
  maxRarity?: number;
};

export type LootRarityConfig = {
  bands?: LootRarityBand[];
  formula?: LootRarityFormula;
  /** Fallback for levels above the highest band; kept in sync with formula.maxRarity on save. */
  defaultMaxRarity?: number;
};

const DEFAULT_CONFIG = bundledRarityConfig as LootRarityConfig;

const itemRarityCache = new Map<string, number | null>();

export function getDefaultLootRarityFormula(): LootRarityFormula {
  const formula = DEFAULT_CONFIG.formula ?? {};
  return {
    perLevel: formula.perLevel ?? 0.4,
    maxRarity: formula.maxRarity ?? 6,
  };
}

function normalizeLootRarityFormula(raw: unknown): LootRarityFormula {
  const defaults = getDefaultLootRarityFormula();
  if (!raw || typeof raw !== "object") return { ...defaults };
  const input = raw as LootRarityFormula;
  const out: LootRarityFormula = { ...defaults };
  if (typeof input.perLevel === "number" && Number.isFinite(input.perLevel)) {
    out.perLevel = Math.max(0, input.perLevel);
  }
  if (typeof input.maxRarity === "number" && Number.isFinite(input.maxRarity)) {
    out.maxRarity = Math.max(0, Math.floor(input.maxRarity));
  }
  return out;
}

/** Linear curve: min(maxRarity, floor(level × perLevel)). */
export function rarityFromLinearFormula(
  level: number,
  formula: LootRarityFormula,
): number {
  const perLevel = formula.perLevel ?? 0.4;
  const ceiling = formula.maxRarity ?? 6;
  const lvl = Math.max(0, Math.floor(level));
  const raw = Math.floor(lvl * perLevel);
  return Math.min(ceiling, Math.max(0, raw));
}

export function recalculateBandRaritiesFromFormula(
  bands: LootRarityBand[],
  formula: LootRarityFormula,
): LootRarityBand[] {
  return bands.map((band) => ({
    maxLevel: band.maxLevel,
    maxRarity: rarityFromLinearFormula(band.maxLevel, formula),
  }));
}

export function rarityForLocationLevelFromConfig(
  level: number,
  config: LootRarityConfig,
): number {
  const bands = config.bands ?? [];
  const lvl = Math.max(0, Math.floor(level));
  for (const band of bands) {
    if (lvl <= band.maxLevel) return band.maxRarity;
  }
  return config.defaultMaxRarity ?? bands.at(-1)?.maxRarity ?? 6;
}

export function getBundledLootRarityConfig(): LootRarityConfig {
  return foundry.utils.deepClone(DEFAULT_CONFIG);
}

export function normalizeLootRarityConfig(raw: unknown): LootRarityConfig {
  const base = getBundledLootRarityConfig();
  if (!raw || typeof raw !== "object") return {};
  const input = raw as LootRarityConfig;
  const bands = Array.isArray(input.bands)
    ? input.bands
        .map((band) => ({
          maxLevel: Math.max(0, Math.floor(Number(band.maxLevel))),
          maxRarity: Math.max(0, Math.floor(Number(band.maxRarity))),
        }))
        .filter(
          (band) => Number.isFinite(band.maxLevel) && Number.isFinite(band.maxRarity),
        )
        .sort((a, b) => a.maxLevel - b.maxLevel)
    : undefined;

  const out: LootRarityConfig = {};
  if (bands?.length) out.bands = bands;
  if (typeof input.defaultMaxRarity === "number" && Number.isFinite(input.defaultMaxRarity)) {
    out.defaultMaxRarity = Math.max(0, Math.floor(input.defaultMaxRarity));
  }
  out.formula = normalizeLootRarityFormula(input.formula ?? base.formula);

  if (!out.bands?.length) {
    out.bands = base.bands;
  }
  if (out.defaultMaxRarity === undefined) {
    out.defaultMaxRarity = out.formula?.maxRarity ?? base.defaultMaxRarity;
  }
  return out;
}

export function getLootRarityConfig(): LootRarityConfig {
  const stored = game.settings.get(MODULE_ID, SCAVENGING_SETTINGS.lootRarityConfig) as unknown;
  if (!stored || typeof stored !== "object") {
    return getBundledLootRarityConfig();
  }
  const normalized = normalizeLootRarityConfig(stored);
  const hasWorldBands =
    Array.isArray((stored as LootRarityConfig).bands) &&
    (stored as LootRarityConfig).bands!.length > 0;
  if (!hasWorldBands) {
    return {
      ...getBundledLootRarityConfig(),
      ...normalized,
      bands: getBundledLootRarityConfig().bands,
    };
  }
  return normalized;
}

export function getMaxRarityForLocationLevel(level: number): number {
  return rarityForLocationLevelFromConfig(level, getLootRarityConfig());
}

function parseRarityValue(raw: unknown): number | null {
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

function readRarityFromItemSystem(system: unknown): number | null {
  if (!system || typeof system !== "object") return null;
  return parseRarityValue((system as Record<string, unknown>).rarity);
}

export async function getItemRarityFromUuid(uuid: string): Promise<number | null> {
  const key = uuid.trim();
  if (!key) return null;
  if (itemRarityCache.has(key)) return itemRarityCache.get(key)!;

  try {
    const doc = await fromUuid(key);
    const rarity = readRarityFromItemSystem(
      (doc as { system?: unknown } | null)?.system,
    );
    itemRarityCache.set(key, rarity);
    return rarity;
  } catch {
    itemRarityCache.set(key, null);
    return null;
  }
}

export async function resolveRowRarity(row: LootTableRow): Promise<number | null> {
  if (row.rarity != null) return row.rarity;
  const uuid = row.documentUuid?.trim();
  if (!uuid) return null;
  return getItemRarityFromUuid(uuid);
}

export function isRowEligibleByRarity(row: LootTableRow, maxRarity: number): boolean {
  if (row.rarity == null) return true;
  return row.rarity <= maxRarity;
}

/** Clear cached item rarities (e.g. after compendium reload). */
export function clearItemRarityCache(): void {
  itemRarityCache.clear();
}
