import bundledCapConfig from "../data/scavenging/loot/value-cap-by-level.json";
import { MODULE_ID } from "../constants.js";
import type { LootTableRow } from "./lootTableRanges.js";
import { SCAVENGING_SETTINGS } from "./scavengingSettings.js";

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

export function isRowEligibleByCaps(row: LootTableRow, maxCaps: number): boolean {
  if (row.caps == null) return true;
  return row.caps <= maxCaps;
}

/** @deprecated Use isRowEligibleByCaps */
export const isRowEligible = isRowEligibleByCaps;

/** Clear cached item prices (e.g. after compendium reload). */
export function clearItemCapsCache(): void {
  itemCapsCache.clear();
}
