import { isEquippableFalloutGear } from "../integrations/fallout.js";
import {
  computeActorDerivedStatistics,
  formatMeleeDamageForPdf,
  readActorSpecial,
  type FalloutActorSystemSlice,
} from "./actorDerivedStats.js";
import { skillPdfFieldBase } from "./skillPdfSlugs.js";

export interface ActorPdfSnapshot {
  text: Record<string, string>;
  checks: Record<string, boolean>;
}

const BODY_PART_TO_PDF: Record<string, string> = {
  head: "head",
  torso: "torso",
  armL: "left-arm",
  armR: "right-arm",
  legL: "left-leg",
  legR: "right-leg",
};

function stripHtml(html: string): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return (tmp.textContent ?? tmp.innerText ?? "").replace(/\s+/g, " ").trim();
}

function plainItemText(item: Item): string {
  const desc = (item.system as { description?: { value?: string } }).description
    ?.value;
  if (desc && desc.includes("<")) return stripHtml(desc);
  return desc?.trim() ?? "";
}

function getActorItems(actor: Actor): Item[] {
  const collection = actor.items as {
    contents?: Item[];
    map?: (fn: (item: Item) => Item) => Item[];
  };
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.map === "function") return collection.map((i) => i);
  return [];
}

function isEquipped(item: Item): boolean {
  return Boolean((item.system as { equipped?: boolean }).equipped);
}

function formatNumber(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : String(value);
}

function readResistance(
  resistance: {
    physical?: number;
    energy?: number;
    radiation?: number;
    poison?: number;
  } | undefined,
): { phys: string; en: string; rad: string } {
  return {
    phys: formatNumber(resistance?.physical ?? 0),
    en: formatNumber(resistance?.energy ?? 0),
    rad: formatNumber(resistance?.radiation ?? 0),
  };
}

function applyBodyPartResistances(
  snapshot: ActorPdfSnapshot,
  system: FalloutActorSystemSlice,
): void {
  const parts = system.body_parts ?? {};
  for (const [systemKey, pdfPrefix] of Object.entries(BODY_PART_TO_PDF)) {
    const part = parts[systemKey];
    if (!part) continue;
    const { phys, en, rad } = readResistance(part.resistance);
    const enField =
      pdfPrefix === "torso" ? "toros_en_dr" : `${pdfPrefix}_en_dr`;
    snapshot.text[`${pdfPrefix}_phys_dr`] = phys;
    snapshot.text[enField] = en;
    snapshot.text[`${pdfPrefix}_rad_dr`] = rad;
    const hp = part.hp;
    if (hp) {
      const current = hp.value ?? hp.max;
      snapshot.text[`${pdfPrefix}_hp`] = formatNumber(current);
    }
  }
}

function applyBodyPartsFromActor(
  snapshot: ActorPdfSnapshot,
  system: FalloutActorSystemSlice,
  actor: Actor,
): void {
  if (system.body_parts && Object.keys(system.body_parts).length > 0) {
    applyBodyPartResistances(snapshot, system);
    return;
  }
  const totals: Record<
    string,
    { physical: number; energy: number; radiation: number }
  > = {};
  for (const key of Object.keys(BODY_PART_TO_PDF)) {
    totals[key] = { physical: 0, energy: 0, radiation: 0 };
  }

  for (const item of getActorItems(actor)) {
    if (!isEquippableFalloutGear(item) || !isEquipped(item)) continue;
    const sys = item.system as {
      location?: { value?: string } | string;
      resistance?: {
        physical?: number;
        energy?: number;
        radiation?: number;
      };
      dr?: {
        physical?: number;
        energy?: number;
        radiation?: number;
      };
    };
    const resistance = sys.resistance ?? sys.dr;
    if (!resistance) continue;

    let location =
      typeof sys.location === "string"
        ? sys.location
        : (sys.location?.value ?? "");
    location = location.toLowerCase();
    const map: Record<string, string> = {
      head: "head",
      torso: "torso",
      arms: "armL",
      arm: "armL",
      arml: "armL",
      armr: "armR",
      legs: "legL",
      leg: "legL",
      legl: "legL",
      legr: "legR",
    };
    const partKey = map[location];
    if (!partKey || !totals[partKey]) continue;
    totals[partKey].physical += Number(resistance.physical ?? 0);
    totals[partKey].energy += Number(resistance.energy ?? 0);
    totals[partKey].radiation += Number(resistance.radiation ?? 0);
  }

  const fakeSystem: FalloutActorSystemSlice = {
    body_parts: Object.fromEntries(
      Object.entries(totals).map(([key, res]) => [
        key,
        { resistance: res },
      ]),
    ),
  };
  applyBodyPartResistances(snapshot, fakeSystem);
}

function isWeaponDamageTagged(item: Item): boolean {
  const sys = item.system as { tag?: boolean; tagged?: boolean };
  if (sys.tag || sys.tagged) return true;
  return Boolean((item.flags as { favorite?: boolean }).favorite);
}

function formatWeaponField(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
  }
  return formatNumber(value);
}

function applyWeapons(snapshot: ActorPdfSnapshot, actor: Actor): void {
  const weapons = getActorItems(actor)
    .filter((i) => i.type === "weapon")
    .sort((a, b) => {
      const af = Boolean((a.flags as { favorite?: boolean }).favorite);
      const bf = Boolean((b.flags as { favorite?: boolean }).favorite);
      if (af !== bf) return af ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 5);

  weapons.forEach((weapon, index) => {
    const n = index + 1;
    const sys = weapon.system as Record<string, unknown>;
    snapshot.text[`weapons_name${n}`] = weapon.name;
    snapshot.text[`weapons_damage${n}`] = formatWeaponField(
      sys.damage ?? sys.dmg,
    );
    snapshot.text[`weapons_rate${n}`] = formatWeaponField(sys.rate ?? sys.rof);
    snapshot.text[`weapons_range${n}`] = formatWeaponField(sys.range);
    snapshot.text[`weapons_ammo${n}`] = formatWeaponField(
      sys.ammoType ?? sys.ammo ?? sys.ammunition,
    );
    snapshot.text[`weapons_type${n}`] = formatWeaponField(
      sys.weaponType ?? sys.type,
    );
    snapshot.text[`weapons_skill${n}`] = formatWeaponField(
      sys.skill ?? sys.defaultAttribute,
    );
    snapshot.text[`weapons_tn${n}`] = formatWeaponField(sys.tn ?? sys.target);
    snapshot.text[`weapons_weight${n}`] = formatWeaponField(
      sys.weight ?? sys.mass,
    );
    snapshot.text[`weapons_effects${n}`] = formatWeaponField(
      sys.effects ?? sys.effect,
    );
    snapshot.text[`weapons_qualities${n}`] = formatWeaponField(
      sys.qualities ?? sys.quality,
    );

    if (isWeaponDamageTagged(weapon)) {
      snapshot.checks[`weapon_damage_tag${n}`] = true;
    }
  });
}

function applyAmmo(snapshot: ActorPdfSnapshot, actor: Actor): void {
  const ammoItems = getActorItems(actor).filter((i) => i.type === "ammo");
  const byName = new Map<string, number>();
  for (const item of ammoItems) {
    const qty = Number(
      (item.system as { quantity?: number }).quantity ?? 1,
    );
    byName.set(item.name, (byName.get(item.name) ?? 0) + qty);
  }
  const rows = [...byName.entries()].slice(0, 8);
  rows.forEach(([name, qty], index) => {
    const n = index + 1;
    snapshot.text[`ammo_caliber${n}`] = name;
    snapshot.text[`ammo_caliber_quantity${n}`] = String(qty);
  });
}

function applyGear(snapshot: ActorPdfSnapshot, actor: Actor): void {
  const gearTypes = new Set([
    "apparel",
    "ammo",
    "consumable",
    "misc",
    "book",
    "mod",
    "apparel_mod",
    "weapon_mod",
  ]);
  const lines = getActorItems(actor)
    .filter((i) => gearTypes.has(i.type))
    .slice(0, 18);

  lines.forEach((item, index) => {
    const n = index + 1;
    snapshot.text[`gear_item${n}`] = item.name;
    const weight = (item.system as { weight?: number }).weight;
    if (weight !== undefined) {
      snapshot.text[`gear_item_lbs${n}`] = formatNumber(weight);
    }
  });
}

function applyPerksAndTraits(
  snapshot: ActorPdfSnapshot,
  actor: Actor,
  system: FalloutActorSystemSlice,
): void {
  const rows: Array<{ name: string; effect: string; rank: string }> = [];

  const originTrait = String(system.trait ?? "").trim();
  if (originTrait) {
    rows.push({ name: originTrait, effect: "Origin trait", rank: "" });
  }

  for (const item of getActorItems(actor)) {
    if (item.type !== "trait" && item.type !== "perk") continue;
    if (item.type === "trait" && item.name === originTrait) continue;
    const effect = plainItemText(item) || item.name;
    const rank = formatNumber(
      (item.system as { rank?: number; level?: number }).rank ??
        (item.system as { level?: number }).level,
    );
    rows.push({ name: item.name, effect, rank });
  }

  rows.slice(0, 13).forEach((row, index) => {
    const n = index + 1;
    snapshot.text[`Perks_Traits_name${n}`] = row.name;
    snapshot.text[`Perks_Traits_effect${n}`] = row.effect;
    if (row.rank) snapshot.text[`Perks_Traits_rank${n}`] = row.rank;
  });
}

function applySkills(snapshot: ActorPdfSnapshot, actor: Actor): void {
  for (const item of getActorItems(actor)) {
    if (item.type !== "skill") continue;
    const base = skillPdfFieldBase(item.name);
    if (!base) continue;
    const sys = item.system as { value?: number; tag?: boolean };
    snapshot.text[`${base}_rank`] = formatNumber(sys.value ?? 0);
    if (sys.tag) snapshot.checks[`${base}_tag`] = true;
  }
}

export function buildActorPdfSnapshot(actor: Actor): ActorPdfSnapshot {
  const system = actor.system as FalloutActorSystemSlice;
  const special = readActorSpecial(system);
  const derived = computeActorDerivedStatistics(actor, system);

  const snapshot: ActorPdfSnapshot = { text: {}, checks: {} };

  snapshot.text.character_name = actor.name;
  snapshot.text.origin = String(system.origin ?? "");
  snapshot.text.strenght = formatNumber(special.str);
  snapshot.text.perception = formatNumber(special.per);
  snapshot.text.endurance = formatNumber(special.end);
  snapshot.text.charisma = formatNumber(special.cha);
  snapshot.text.intelligence = formatNumber(special.int);
  snapshot.text.agility = formatNumber(special.agi);
  snapshot.text.Luck = formatNumber(special.luc);
  snapshot.text.luck_points = formatNumber(derived.luckPoints);
  snapshot.text.level = formatNumber(system.level?.value ?? 1);
  snapshot.text.xp_earned = formatNumber(system.level?.currentXP ?? 0);
  snapshot.text.xp_to_nextlevel = formatNumber(system.level?.nextLevelXP ?? "");
  snapshot.text.health_maximum_hp = formatNumber(
    system.health?.max ?? derived.healthPoints,
  );
  snapshot.text.health_current_hp = formatNumber(
    system.health?.value ?? system.health?.max ?? derived.healthPoints,
  );
  snapshot.text.Caps = formatNumber(system.currency?.caps ?? 0);
  snapshot.text.maximum_carry_weight = formatNumber(derived.carryWeight);
  snapshot.text.current_carry_weight = formatNumber(
    system.derived?.carryWeight?.value ?? "",
  );
  snapshot.text.defense = formatNumber(derived.defense);
  snapshot.text.initiative = formatNumber(derived.initiative);
  snapshot.text.melee_damage = formatMeleeDamageForPdf(derived);

  const poisonImmune = Boolean(system.immunities?.poison);
  snapshot.text.poison_dr = poisonImmune ? "Immune" : formatNumber(0);

  applySkills(snapshot, actor);
  applyPerksAndTraits(snapshot, actor, system);
  applyBodyPartsFromActor(snapshot, system, actor);
  applyWeapons(snapshot, actor);
  applyGear(snapshot, actor);
  applyAmmo(snapshot, actor);

  return snapshot;
}
