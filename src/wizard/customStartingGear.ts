import { MODULE_ID } from "../constants.js";

/** Gear from the rulebook that has no matching Fallout compendium item. */
const CUSTOM_STARTING_GEAR: Record<
  string,
  { name: string; type: string; img: string; system: Record<string, unknown> }
> = {
  Board: {
    name: "Board",
    type: "weapon",
    img: "systems/fallout/assets/icons/items/weapon.svg",
    system: {
      creatureAttribute: "str",
      creatureSkill: "Melee Weapons",
      damage: { damageType: { physical: true }, rating: 6 },
      weaponQuality: { two_handed: { value: true } },
      range: "close",
      weaponType: "meleeWeapons",
      source: "core_rulebook",
    },
  },
};

export function getCustomStartingGear(
  name: string,
): (typeof CUSTOM_STARTING_GEAR)[string] | undefined {
  return CUSTOM_STARTING_GEAR[name];
}

export function buildPersonalTrinketItem(text: string): {
  name: string;
  type: string;
  img: string;
  system: Record<string, unknown>;
  flags: Record<string, Record<string, unknown>>;
} {
  const trimmed = text.trim();
  return {
    name: "Personal Trinket",
    type: "miscellany",
    img: "systems/fallout/assets/icons/items/miscellany.svg",
    system: {
      description: `<p>${trimmed}</p>`,
      favorite: false,
      source: "core_rulebook",
      cost: 0,
      quantity: 1,
      rarity: 0,
      stashed: false,
      weight: 0,
      canBeScrapped: false,
      isJunk: false,
      effect: trimmed,
      quantityRoll: "",
    },
    flags: {
      [MODULE_ID]: { personalTrinket: true },
    },
  };
}
