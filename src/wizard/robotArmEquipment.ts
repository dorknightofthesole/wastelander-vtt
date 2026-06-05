import type { ResolvedEquipmentLine } from "./equipmentRules.js";

/** Starting shots for Mister Handy / robot arm weapons (Core Rulebook p.76). */
export const ROBOT_ARM_WEAPON_AMMO_SHOTS = 20;

interface RobotWeaponArm {
  weapon: string;
  ammo: string;
}

/** Pack labels (lowercase) → compendium weapon + ammo. */
const ROBOT_WEAPON_ARMS: Record<string, RobotWeaponArm> = {
  "flamer arm attachment": { weapon: "Flamer", ammo: "Flamer Fuel" },
  "laser emitter arm attachment": { weapon: "Laser Emitter", ammo: "Fusion Cell" },
  "10mm auto pistol arm": { weapon: "10mm Auto Pistol", ammo: "10mm Round" },
};

/** Non-ammunition robot arms → compendium weapon name. */
const ROBOT_MELEE_ARMS: Record<string, string> = {
  "pincer arm attachment": "Pincer",
  "buzz-saw arm attachment": "Buzz-Saw",
};

/**
 * Expand a robot arm pack line into weapon (+ fixed-shot ammo when applicable).
 */
export function expandRobotArmEquipmentLine(
  text: string,
  ammoShots: number,
): ResolvedEquipmentLine[] {
  const key = text.trim().toLowerCase();
  const weaponArm = ROBOT_WEAPON_ARMS[key];
  if (weaponArm) {
    return [
      { text, compendiumName: weaponArm.weapon },
      {
        text: `${weaponArm.ammo} (${ammoShots} shots)`,
        compendiumName: weaponArm.ammo,
        shots: ammoShots,
      },
    ];
  }
  const meleeArm = ROBOT_MELEE_ARMS[key];
  if (meleeArm) {
    return [{ text, compendiumName: meleeArm }];
  }
  return [{ text }];
}
