import bundledGearMappings from "../data/npcGen/npc-gear-mappings.json";
import { MODULE_ID } from "../constants.js";
import { NPC_GENERATOR_SETTINGS } from "./npcGeneratorSettings.js";

export type GearRollSpec = { table: string; count: number };

/** Compendium item grant — optional quantityRoll for ammo (e.g. 10+5dc). */
export type GearItemSpec = {
  name: string;
  quantityRoll?: string;
  shots?: number;
};

export type GearSpec = {
  items?: GearItemSpec[];
  rolls?: GearRollSpec[];
};

export type NpcGearMappingRow = GearSpec;

export type NpcGearMappingsFile = {
  professions: Record<string, NpcGearMappingRow>;
  demeanor: Record<string, NpcGearMappingRow>;
  distinctiveFeatures: Record<string, NpcGearMappingRow>;
};

/** GM-editable profession + demeanor gear (distinctive features stay bundled). */
export type NpcGearMappingsConfig = {
  professions?: Record<string, NpcGearMappingRow>;
  demeanor?: Record<string, NpcGearMappingRow>;
};

const BUNDLED = bundledGearMappings as NpcGearMappingsFile;

function normalizeGearRoll(raw: unknown): GearRollSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { table?: unknown; count?: unknown };
  const table = String(row.table ?? "").trim();
  if (!table) return null;
  const count = Math.max(1, Math.floor(Number(row.count ?? 1)));
  return { table, count };
}

export function normalizeGearItem(raw: unknown): GearItemSpec | null {
  if (typeof raw === "string") {
    const name = raw.trim();
    return name ? { name } : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { name?: unknown; quantityRoll?: unknown; shots?: unknown };
  const name = String(row.name ?? "").trim();
  if (!name) return null;
  const item: GearItemSpec = { name };
  if (row.quantityRoll != null) {
    const roll = String(row.quantityRoll).replace(/\s+/g, "").trim();
    if (roll) item.quantityRoll = roll;
  }
  if (row.shots != null) {
    const shots = Math.floor(Number(row.shots));
    if (Number.isFinite(shots) && shots > 0) item.shots = shots;
  }
  return item;
}

export function isGearSpecEmpty(gear: GearSpec | undefined): boolean {
  if (!gear) return true;
  return !(gear.items?.length || gear.rolls?.length);
}

export function normalizeGearSpec(raw: unknown): GearSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const input = raw as { items?: unknown; rolls?: unknown };
  const items = Array.isArray(input.items)
    ? input.items
        .map(normalizeGearItem)
        .filter((row): row is GearItemSpec => row != null)
    : undefined;
  const rolls = Array.isArray(input.rolls)
    ? input.rolls
        .map(normalizeGearRoll)
        .filter((row): row is GearRollSpec => row != null)
    : undefined;
  if (!items?.length && !rolls?.length) return { items: [], rolls: [] };
  return {
    items: items?.length ? items : undefined,
    rolls: rolls?.length ? rolls : undefined,
  };
}

function normalizeGearRowMap(
  raw: unknown,
): Record<string, NpcGearMappingRow> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, NpcGearMappingRow> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const label = key.trim();
    if (!label) continue;
    const gear = normalizeGearSpec(value);
    if (gear) out[label] = gear;
  }
  return out;
}

export function normalizeNpcGearMappingsConfig(raw: unknown): NpcGearMappingsConfig {
  if (!raw || typeof raw !== "object") return {};
  const input = raw as NpcGearMappingsConfig;
  return {
    professions: normalizeGearRowMap(input.professions),
    demeanor: normalizeGearRowMap(input.demeanor),
  };
}

export function getBundledNpcGearMappings(): NpcGearMappingsFile {
  return {
    professions: normalizeGearRowMap(BUNDLED.professions),
    demeanor: normalizeGearRowMap(BUNDLED.demeanor),
    distinctiveFeatures: normalizeGearRowMap(BUNDLED.distinctiveFeatures),
  };
}

export function getDefaultNpcGearMappingsConfig(): NpcGearMappingsConfig {
  const bundled = getBundledNpcGearMappings();
  return {
    professions: { ...bundled.professions },
    demeanor: { ...bundled.demeanor },
  };
}

function hasStoredGearConfig(config: NpcGearMappingsConfig): boolean {
  const professions = Object.keys(config.professions ?? {});
  const demeanor = Object.keys(config.demeanor ?? {});
  return professions.length > 0 || demeanor.length > 0;
}

export function getNpcGearMappingsConfig(): NpcGearMappingsConfig {
  const stored = (game.settings as { get: (scope: string, key: string) => unknown }).get(
    MODULE_ID,
    NPC_GENERATOR_SETTINGS.npcGearMappings,
  );
  const normalized = normalizeNpcGearMappingsConfig(stored);
  return hasStoredGearConfig(normalized)
    ? normalized
    : getDefaultNpcGearMappingsConfig();
}

function findGearMappingKey(
  table: Record<string, NpcGearMappingRow>,
  overrides: Record<string, NpcGearMappingRow> | undefined,
  label: string | null,
): string | null {
  if (!label) return null;
  const trimmed = label.trim();
  const lower = trimmed.toLowerCase();

  if (overrides && trimmed in overrides) return trimmed;
  if (overrides) {
    for (const key of Object.keys(overrides)) {
      if (key.trim().toLowerCase() === lower) return key;
    }
  }

  if (trimmed in table) return trimmed;
  for (const key of Object.keys(table)) {
    if (key.trim().toLowerCase() === lower) return key;
  }

  return null;
}

function hasGearMappingInMaps(
  table: Record<string, NpcGearMappingRow>,
  overrides: Record<string, NpcGearMappingRow> | undefined,
  label: string | null,
): boolean {
  return findGearMappingKey(table, overrides, label) != null;
}

function resolveGearFromMaps(
  table: Record<string, NpcGearMappingRow>,
  overrides: Record<string, NpcGearMappingRow> | undefined,
  label: string | null,
): GearSpec | undefined {
  if (!label) return undefined;
  const trimmed = label.trim();
  const lower = trimmed.toLowerCase();

  const overrideDirect = overrides?.[trimmed];
  if (overrideDirect) return normalizeGearSpec(overrideDirect);

  if (overrides) {
    for (const [key, gear] of Object.entries(overrides)) {
      if (key.trim().toLowerCase() === lower) return normalizeGearSpec(gear);
    }
  }

  const bundledDirect = table[trimmed];
  if (bundledDirect) return normalizeGearSpec(bundledDirect);

  for (const [key, gear] of Object.entries(table)) {
    if (key.trim().toLowerCase() === lower) return normalizeGearSpec(gear);
  }

  return undefined;
}

export function hasProfessionGearMapping(profession: string | null): boolean {
  const bundled = getBundledNpcGearMappings();
  const config = getNpcGearMappingsConfig();
  return hasGearMappingInMaps(
    bundled.professions,
    config.professions,
    profession,
  );
}

export function hasDemeanorGearMapping(demeanor: string | null): boolean {
  const bundled = getBundledNpcGearMappings();
  const config = getNpcGearMappingsConfig();
  return hasGearMappingInMaps(bundled.demeanor, config.demeanor, demeanor);
}

export function resolveProfessionGear(profession: string | null): GearSpec | undefined {
  const bundled = getBundledNpcGearMappings();
  const config = getNpcGearMappingsConfig();
  return resolveGearFromMaps(
    bundled.professions,
    config.professions,
    profession,
  );
}

export function resolveDemeanorGear(demeanor: string | null): GearSpec | undefined {
  const bundled = getBundledNpcGearMappings();
  const config = getNpcGearMappingsConfig();
  return resolveGearFromMaps(
    bundled.demeanor,
    config.demeanor,
    demeanor,
  );
}

export function resolveFeatureGear(feature: string | null): GearSpec | undefined {
  if (!feature) return undefined;
  const table = getBundledNpcGearMappings().distinctiveFeatures;
  return resolveGearFromMaps(table, undefined, feature);
}

/** Serialize items for settings: `Machete, 10mm Round@10+5dc` */
export function formatGearItemsField(spec: GearSpec | undefined): string {
  return (spec?.items ?? [])
    .map((item) =>
      item.quantityRoll ? `${item.name}@${item.quantityRoll}` : item.name,
    )
    .join(", ");
}

/** Serialize loot rolls as `Table:count, Table:count`. */
export function formatGearRollsField(spec: GearSpec | undefined): string {
  return (spec?.rolls ?? [])
    .map((roll) => `${roll.table}:${roll.count}`)
    .join(", ");
}

export function parseGearItemsField(text: string): GearItemSpec[] {
  const items: GearItemSpec[] = [];
  for (const part of text.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const at = trimmed.lastIndexOf("@");
    if (at > 0) {
      const name = trimmed.slice(0, at).trim();
      const quantityRoll = trimmed.slice(at + 1).replace(/\s+/g, "").trim();
      if (name) items.push({ name, quantityRoll: quantityRoll || undefined });
      continue;
    }
    items.push({ name: trimmed });
  }
  return items;
}

export function parseGearRollsField(text: string): GearRollSpec[] {
  const rolls: GearRollSpec[] = [];
  for (const part of text.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.lastIndexOf(":");
    if (colon <= 0) {
      rolls.push({ table: trimmed, count: 1 });
      continue;
    }
    const table = trimmed.slice(0, colon).trim();
    const count = Math.max(1, Math.floor(Number(trimmed.slice(colon + 1)) || 1));
    if (table) rolls.push({ table, count });
  }
  return rolls;
}

export function gearSpecFromFields(itemsText: string, rollsText: string): GearSpec {
  const items = parseGearItemsField(itemsText);
  const rolls = parseGearRollsField(rollsText);
  return {
    items: items.length ? items : undefined,
    rolls: rolls.length ? rolls : undefined,
  };
}

export type NpcGearMappingFormRow = {
  key: string;
  itemsText: string;
  rollsText: string;
};

export function gearRowsFromMap(
  map: Record<string, NpcGearMappingRow>,
): NpcGearMappingFormRow[] {
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, spec]) => ({
      key,
      itemsText: formatGearItemsField(spec),
      rollsText: formatGearRollsField(spec),
    }));
}

export function gearMapFromRows(
  rows: NpcGearMappingFormRow[],
): Record<string, NpcGearMappingRow> {
  const out: Record<string, NpcGearMappingRow> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    out[key] = gearSpecFromFields(row.itemsText, row.rollsText);
  }
  return out;
}
