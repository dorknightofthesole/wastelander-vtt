import {
  buildEquipmentItemIndex,
  enrichEquipmentLine,
  type CompendiumItemIndexEntry,
} from "../integrations/equipmentItems.js";
import { getCompendiumItem } from "../integrations/fallout.js";
import type { FalloutAttributeKey } from "../integrations/fallout.js";
import { getActorItems } from "./actorItems.js";
import { readActorSpecial, type FalloutActorSystemSlice } from "./actorDerivedStats.js";

/** Fallout `system.weaponType` → skill display name on the character sheet PDF. */
const WEAPON_TYPE_TO_SKILL: Record<string, string> = {
  energyWeapons: "Energy Weapons",
  smallGuns: "Small Guns",
  bigGuns: "Big Guns",
  meleeWeapons: "Melee Weapons",
  explosives: "Explosives",
  throwing: "Throwing",
  unarmed: "Unarmed",
};

const ATTR_KEYS: FalloutAttributeKey[] = [
  "str",
  "per",
  "end",
  "cha",
  "int",
  "agi",
  "luc",
];

function normalizeAttribute(raw: unknown): FalloutAttributeKey {
  const key = String(raw ?? "str").toLowerCase();
  return (ATTR_KEYS as string[]).includes(key) ? (key as FalloutAttributeKey) : "str";
}

function formatWeaponFireRate(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "";
  return String(n);
}

function formatNumber(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : String(value);
}

function qualityLabel(key: string, rank: number): string {
  const base = key
    .replace(/_x$/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return rank > 1 ? `${base} ${rank}` : base;
}

function formatQualitiesFromDamage(damage: unknown): string {
  if (!damage || typeof damage !== "object") return "";
  const d = damage as {
    weaponQuality?: Record<string, { value?: number; rank?: number }>;
  };
  const qualities = d.weaponQuality;
  if (!qualities) return "";

  const active: string[] = [];
  for (const [key, entry] of Object.entries(qualities)) {
    const rank = Math.max(
      Number(entry?.value ?? 0),
      Number(entry?.rank ?? 0),
    );
    if (rank > 0) active.push(qualityLabel(key, rank));
  }
  return active.join(", ");
}

function formatDamageTypes(damageType: Record<string, boolean> | undefined): string {
  if (!damageType) return "";
  const labels: string[] = [];
  if (damageType.physical) labels.push("Physical");
  if (damageType.energy) labels.push("Energy");
  if (damageType.radiation) labels.push("Radiation");
  if (damageType.poison) labels.push("Poison");
  return labels.join("/");
}

function formatDamageEffects(
  damageEffect: Record<string, { value?: number; rank?: number }> | undefined,
): string[] {
  if (!damageEffect) return [];
  const out: string[] = [];
  for (const [key, entry] of Object.entries(damageEffect)) {
    const rank = Math.max(
      Number(entry?.value ?? 0),
      Number(entry?.rank ?? 0),
    );
    if (rank > 0) out.push(qualityLabel(key, rank));
  }
  return out;
}

export function formatWeaponDamage(damage: unknown): string {
  if (!damage || typeof damage !== "object") return "";
  const d = damage as {
    rating?: number;
    damageType?: Record<string, boolean>;
    damageEffect?: Record<string, { value?: number; rank?: number }>;
  };
  const rating = Number(d.rating ?? 0);
  if (!rating) return "";

  const parts = [`${rating} CD`];
  const types = formatDamageTypes(d.damageType);
  if (types) parts.push(types);
  const effects = formatDamageEffects(d.damageEffect);
  if (effects.length) parts.push(effects.join(", "));
  return parts.join(" ");
}

export function formatWeaponQualities(sys: Record<string, unknown>): string {
  const top = String(sys.qualities ?? "").trim();
  if (top) return top;
  return formatQualitiesFromDamage(sys.damage);
}

export function formatWeaponRange(range: unknown): string {
  if (range === null || range === undefined || range === "") return "";
  if (typeof range === "number") {
    if (range < 0) return "";
    return String(range);
  }
  const text = String(range).trim();
  if (!text) return "";
  const localized = game.i18n.localize(`FALLOUT.WEAPON.range.${text}`);
  if (localized && !localized.startsWith("FALLOUT.")) return localized;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatWeaponTypeLabel(weaponType: unknown): string {
  const key = String(weaponType ?? "").trim();
  if (!key) return "";
  const localized = game.i18n.localize(`FALLOUT.WEAPON.WeaponType.${key}`);
  if (localized && !localized.startsWith("FALLOUT.")) return localized;
  return WEAPON_TYPE_TO_SKILL[key] ?? key;
}

export function resolveWeaponSkillName(sys: Record<string, unknown>): string {
  const custom = String(sys.skill ?? "").trim();
  if (custom) return custom;

  const weaponType = String(sys.weaponType ?? "").trim();
  if (weaponType === "custom") return custom;

  const mapped = WEAPON_TYPE_TO_SKILL[weaponType];
  if (mapped) return mapped;

  return formatWeaponTypeLabel(weaponType);
}

interface ActorSkillRow {
  rank: number;
  tagged: boolean;
  defaultAttribute: FalloutAttributeKey;
}

function buildActorSkillMap(actor: Actor): Map<string, ActorSkillRow> {
  const map = new Map<string, ActorSkillRow>();
  for (const item of getActorItems(actor)) {
    if (item.type !== "skill") continue;
    const sys = item.system as {
      value?: number;
      tag?: boolean;
      defaultAttribute?: string;
    };
    map.set(item.name, {
      rank: Number(sys.value ?? 0),
      tagged: Boolean(sys.tag),
      defaultAttribute: normalizeAttribute(sys.defaultAttribute),
    });
  }
  return map;
}

export function computeWeaponTargetNumber(
  actor: Actor,
  skillName: string,
  sys: Record<string, unknown>,
): string {
  if (!skillName) return "";

  const special = readActorSpecial(actor.system as FalloutActorSystemSlice);
  const skillMap = buildActorSkillMap(actor);
  const skillRow = skillMap.get(skillName);

  const attr = String(sys.attribute ?? "").trim()
    ? normalizeAttribute(sys.attribute)
    : skillRow?.defaultAttribute ?? "agi";

  const skillRank = skillRow?.rank ?? 0;
  const attrValue = special[attr] ?? 0;
  return formatNumber(attrValue + skillRank);
}

export function isWeaponSkillTagged(actor: Actor, skillName: string): boolean {
  if (!skillName) return false;
  const skillRow = buildActorSkillMap(actor).get(skillName);
  return Boolean(skillRow?.tagged);
}

function mergeDamage(
  base: unknown,
  override: unknown,
): Record<string, unknown> | undefined {
  if (!base && !override) return undefined;
  if (!base || typeof base !== "object") {
    return override && typeof override === "object"
      ? { ...(override as Record<string, unknown>) }
      : undefined;
  }
  if (!override || typeof override !== "object") {
    return { ...(base as Record<string, unknown>) };
  }
  const b = base as Record<string, unknown>;
  const o = override as Record<string, unknown>;
  return {
    ...b,
    ...o,
    weaponQuality: {
      ...(b.weaponQuality as object),
      ...(o.weaponQuality as object),
    },
    damageEffect: {
      ...(b.damageEffect as object),
      ...(o.damageEffect as object),
    },
    damageType: {
      ...(b.damageType as object),
      ...(o.damageType as object),
    },
  };
}

function isMeaningfulWeaponValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (typeof value === "object") {
    return Object.keys(value as object).length > 0;
  }
  return true;
}

/** Compendium baseline with actor overrides only where the owned item has data. */
export function mergeWeaponSystemData(
  actorSystem: Record<string, unknown>,
  compendiumSystem: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...compendiumSystem };
  for (const [key, value] of Object.entries(actorSystem)) {
    if (!isMeaningfulWeaponValue(value)) continue;
    if (key === "damage") {
      merged.damage = mergeDamage(compendiumSystem.damage, value);
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

export async function resolveWeaponSystemForExport(
  weapon: Item,
  index?: CompendiumItemIndexEntry[],
): Promise<Record<string, unknown>> {
  const actorSystem = weapon.system as Record<string, unknown>;
  const lookupIndex = index ?? (await buildEquipmentItemIndex());
  const enriched = enrichEquipmentLine(weapon.name, lookupIndex);
  if (!enriched.compendiumUuid) return actorSystem;

  const source = await getCompendiumItem(enriched.compendiumUuid);
  if (!source || source.type !== "weapon") return actorSystem;

  return mergeWeaponSystemData(
    actorSystem,
    source.system as Record<string, unknown>,
  );
}

export interface WeaponPdfRow {
  name: string;
  damage: string;
  rate: string;
  range: string;
  ammo: string;
  type: string;
  skill: string;
  tn: string;
  weight: string;
  effects: string;
  qualities: string;
  damageTagged: boolean;
}

export async function buildWeaponPdfRow(
  weapon: Item,
  actor: Actor,
  index: CompendiumItemIndexEntry[],
): Promise<WeaponPdfRow> {
  const sys = await resolveWeaponSystemForExport(weapon, index);
  const skillName = resolveWeaponSkillName(sys);

  const effectParts = [
    String(sys.effect ?? "").trim(),
    String(sys.damageEffect ?? "").trim(),
  ].filter(Boolean);

  return {
    name: weapon.name,
    damage: formatWeaponDamage(sys.damage),
    rate: formatWeaponFireRate(sys.fireRate),
    range: formatWeaponRange(sys.range),
    ammo: String(sys.ammo ?? "").trim(),
    type: formatWeaponTypeLabel(sys.weaponType),
    skill: skillName,
    tn: computeWeaponTargetNumber(actor, skillName, sys),
    weight: formatNumber(sys.weight),
    effects: effectParts.join("; "),
    qualities: formatWeaponQualities(sys),
    damageTagged: isWeaponSkillTagged(actor, skillName),
  };
}
