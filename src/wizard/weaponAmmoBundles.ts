import bundles from "../data/weapon-ammo-bundles.json";
import type { ResolvedEquipmentLine } from "./equipmentRules.js";

export interface WeaponAmmoBundle {
  weapon: string;
  ammo: string;
  quantityRoll: string;
}

const BUNDLES = bundles as Record<string, WeaponAmmoBundle>;

function bundleToLines(bundle: WeaponAmmoBundle): ResolvedEquipmentLine[] {
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

export function expandWeaponAmmoBundle(lineText: string): ResolvedEquipmentLine[] | null {
  const bundle = getWeaponAmmoBundle(lineText);
  if (!bundle) return null;
  return bundleToLines(bundle);
}
