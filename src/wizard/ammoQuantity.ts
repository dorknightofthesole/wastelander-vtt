import { rollCombatDicePool } from "./combatDice.js";

/**
 * Parse Fallout starting-ammo formulas (e.g. `10+5dc`).
 * Rolls each CD as a d6, converts via the Combat Dice Results table (Core Rulebook p.31),
 * then adds that total to the fixed base.
 */
export function rollFalloutAmmoQuantity(formula: string): number {
  const normalized = formula.replace(/\s+/g, "").toLowerCase();
  const match = normalized.match(/^(\d+)\+(\d+)dc$/);
  if (!match) return 1;

  const base = Number(match[1]);
  const diceCount = Number(match[2]);
  return base + rollCombatDicePool(diceCount);
}

/** Fallout ammo sheet: Current and Shots Remaining (max) both start at 1. */
const AMMO_LOADED_SHOTS = 1;

/**
 * Fallout ranged ammo: `quantity` is total rounds granted; Current and Shots
 * Remaining on the item sheet are both 1 (one stack loaded for firing).
 */
export function ammoQuantityOverride(quantity: number): Record<string, unknown> {
  return {
    quantity,
    shots: { current: AMMO_LOADED_SHOTS, max: AMMO_LOADED_SHOTS },
  };
}

export function ammoQuantityOverrideFromRoll(
  formula: string,
): Record<string, unknown> {
  return ammoQuantityOverride(rollFalloutAmmoQuantity(formula));
}

/** @deprecated Use ammoQuantityOverride */
export const ammoShotsOverride = ammoQuantityOverride;

/** @deprecated Use ammoQuantityOverrideFromRoll */
export const ammoShotsOverrideFromRoll = ammoQuantityOverrideFromRoll;

export function ammoLoadedShotsUpdate(): Record<string, unknown> {
  return {
    "system.shots.current": AMMO_LOADED_SHOTS,
    "system.shots.max": AMMO_LOADED_SHOTS,
  };
}
