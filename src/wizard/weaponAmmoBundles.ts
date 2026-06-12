import bundles from "../data/weapon-ammo-bundles.json";
import type { ResolvedEquipmentLine } from "./equipmentRules.js";

export interface WeaponAmmoBundle {
  weapon: string;
  ammo: string;
  quantityRoll: string;
}

const BUNDLES = bundles as Record<string, WeaponAmmoBundle>;

/** Reverse lookup: compendium weapon name → bundle (first match in JSON). */
const BUNDLE_BY_WEAPON = new Map<string, WeaponAmmoBundle>();
for (const bundle of Object.values(BUNDLES)) {
  const key = bundle.weapon.trim().toLowerCase();
  if (!BUNDLE_BY_WEAPON.has(key)) {
    BUNDLE_BY_WEAPON.set(key, bundle);
  }
}

export function weaponAmmoBundleToLines(
  bundle: WeaponAmmoBundle,
): ResolvedEquipmentLine[] {
  return [
    { text: bundle.weapon, compendiumName: bundle.weapon },
    {
      text: `${bundle.ammo} (${bundle.quantityRoll})`,
      compendiumName: bundle.ammo,
      quantityRoll: bundle.quantityRoll,
    },
  ];
}

export function getWeaponAmmoBundle(lineText: string): WeaponAmmoBundle | undefined {
  return BUNDLES[lineText.trim()];
}

export function getWeaponAmmoBundleByWeaponName(
  weaponName: string,
): WeaponAmmoBundle | undefined {
  return BUNDLE_BY_WEAPON.get(weaponName.trim().toLowerCase());
}

export function expandWeaponAmmoBundle(lineText: string): ResolvedEquipmentLine[] | null {
  const bundle = getWeaponAmmoBundle(lineText);
  if (!bundle) return null;
  return weaponAmmoBundleToLines(bundle);
}
