import type { EquipmentPackDefinition } from "./equipmentRules.js";
import type { WizardState } from "./WizardState.js";

/**
 * How to set `system.origin` when an equipment loadout is chosen.
 * Omit on an origin to keep `systemOrigin` (e.g. default).
 * - `packLabel` — loadout title only (Vault Dweller, Brotherhood, Mister Handy).
 * - `{ prefix }` — prefix + loadout (Super Mutant Brute).
 * - `{ template }` — `{origin}` + `{packLabel}` (Survivor Mercenary, Ghoul Raider).
 */
export type PackSystemOriginRule =
  | "packLabel"
  | { prefix: string }
  | { template: string };

export interface OriginPackOriginSource {
  systemOrigin: string;
  packSystemOrigin?: PackSystemOriginRule;
}

/**
 * Actor `system.origin` from origin + selected equipment pack.
 * Pack `systemOrigin` overrides; else origin `packSystemOrigin` rule; else origin default.
 */
export function resolveActorSystemOrigin(
  origin: OriginPackOriginSource | undefined,
  pack: EquipmentPackDefinition | undefined,
): string {
  if (!origin) return "";
  if (!pack) return origin.systemOrigin;
  if (pack.systemOrigin?.trim()) return pack.systemOrigin.trim();

  const rule = origin.packSystemOrigin;
  if (!rule) return origin.systemOrigin;

  if (rule === "packLabel") return pack.label;

  if (typeof rule === "object" && rule !== null) {
    if ("prefix" in rule && typeof rule.prefix === "string") {
      return `${rule.prefix}${pack.label}`;
    }
    if ("template" in rule && typeof rule.template === "string") {
      return rule.template
        .replace(/\{origin\}/g, origin.systemOrigin)
        .replace(/\{packLabel\}/g, pack.label);
    }
  }

  return origin.systemOrigin;
}

export const SPECIAL_KEYS = [
  "str",
  "per",
  "end",
  "cha",
  "int",
  "agi",
  "luc",
] as const;

export type SpecialKey = (typeof SPECIAL_KEYS)[number];

export interface OriginSpecialOverrides {
  pointBonus?: number;
  maxSkillRank?: number;
  str?: { add?: number; max?: number };
  per?: { add?: number; max?: number };
  end?: { add?: number; max?: number };
  cha?: { add?: number; max?: number };
  int?: { add?: number; max?: number };
  agi?: { add?: number; max?: number };
  luc?: { add?: number; max?: number };
}

export function parseOriginSpecialOverrides(
  raw: Record<string, unknown> | undefined,
): OriginSpecialOverrides {
  return (raw ?? {}) as OriginSpecialOverrides;
}

export function getDefaultSpecialForOrigin(
  overrides: OriginSpecialOverrides,
): WizardState["special"] {
  const special: WizardState["special"] = {
    str: 5,
    per: 5,
    end: 5,
    cha: 5,
    int: 5,
    agi: 5,
    luc: 5,
  };
  for (const key of SPECIAL_KEYS) {
    const add = overrides[key]?.add ?? 0;
    if (add) special[key] = special[key] + add;
  }
  return special;
}

/** Point-buy baseline per attribute (5, or 5 + origin add e.g. 7 for Super Mutant STR/END). */
export function getSpecialBaseline(
  attr: SpecialKey,
  overrides: OriginSpecialOverrides,
): number {
  return 5 + (overrides[attr]?.add ?? 0);
}

export function getSpecialAttributeMax(
  attr: SpecialKey,
  overrides: OriginSpecialOverrides,
): number {
  return overrides[attr]?.max ?? 10;
}

/**
 * Lowest value allowed. Rulebook (p.58): any attribute may be reduced from 5 to 4 for +1 point.
 * Origin free increases (e.g. Super Mutant +2 STR/END) set a higher floor on those stats only.
 */
export function getSpecialAttributeMin(
  attr: SpecialKey,
  overrides: OriginSpecialOverrides,
): number {
  const add = overrides[attr]?.add ?? 0;
  if (add > 0) return getSpecialBaseline(attr, overrides);
  return 4;
}

/** Max skill rank during character creation (all origins). Super Mutants may reach 4 later. */
export function getMaxSkillRankAtCreation(_originId: string | null): number {
  return 3;
}

export function isMisterHandyOrigin(originId: string | null): boolean {
  return originId === "mister-handy";
}

export type OriginImmunityType = "radiation" | "poison";

/** Origin-granted damage immunities (applied to `system.immunities` on the actor). */
export function getOriginImmunities(originId: string | null): OriginImmunityType[] {
  if (originId === "super-mutant" || originId === "mister-handy") {
    return ["radiation", "poison"];
  }
  return [];
}
