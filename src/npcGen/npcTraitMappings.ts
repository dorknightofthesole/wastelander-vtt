import type { FalloutAttributeKey } from "../integrations/fallout.js";
import traitMappings from "../data/npcGen/npc-trait-mappings.json";

export type NpcTraitMapping = {
  aliases?: string[];
  specialBiases?: Partial<Record<FalloutAttributeKey, number>>;
  tagSkills?: string[];
  skillPriorities?: string[];
};

export type NpcTraitMappingsFile = {
  professions: Record<string, NpcTraitMapping>;
  demeanor: Record<string, NpcTraitMapping>;
  default: NpcTraitMapping;
};

const MAPPINGS = traitMappings as NpcTraitMappingsFile;

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function resolveNamedMapping(
  table: Record<string, NpcTraitMapping>,
  label: string | null,
): NpcTraitMapping | null {
  if (!label) return null;
  const trimmed = label.trim();
  const direct = table[trimmed];
  if (direct) return direct;
  const lower = normalizeKey(trimmed);
  for (const [key, mapping] of Object.entries(table)) {
    if (normalizeKey(key) === lower) return mapping;
    for (const alias of mapping.aliases ?? []) {
      if (normalizeKey(alias) === lower) return mapping;
    }
  }
  return null;
}

export function mergeSpecialBiases(
  ...sources: Array<Partial<Record<FalloutAttributeKey, number>> | undefined>
): Partial<Record<FalloutAttributeKey, number>> {
  const merged: Partial<Record<FalloutAttributeKey, number>> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, weight] of Object.entries(source)) {
      const attr = key as FalloutAttributeKey;
      const value = Number(weight);
      if (!Number.isFinite(value) || value <= 0) continue;
      merged[attr] = (merged[attr] ?? 0) + value;
    }
  }
  return merged;
}

export function resolveProfessionMapping(profession: string | null): NpcTraitMapping {
  return resolveNamedMapping(MAPPINGS.professions, profession) ?? MAPPINGS.default;
}

export function resolveDemeanorMapping(demeanor: string | null): NpcTraitMapping {
  return resolveNamedMapping(MAPPINGS.demeanor, demeanor) ?? {};
}

export function getNpcTraitMappings(): NpcTraitMappingsFile {
  return MAPPINGS;
}
