import {
  evaluateFalloutRoll,
  type WizardRollContext,
} from "../integrations/fallout.js";

/**
 * Parse Fallout starting-ammo formulas (e.g. `10+5dc`) and roll via the
 * Fallout system's `dc` die (`/r 10+5dc` equivalent).
 */
export async function rollFalloutAmmoQuantity(
  formula: string,
  context?: WizardRollContext,
): Promise<number> {
  const normalized = formula.replace(/\s+/g, "").toLowerCase();
  const match = normalized.match(/^(\d+)\+(\d+)dc$/);
  if (!match) return 1;

  return evaluateFalloutRoll(normalized, {
    label: game.i18n.localize("WASTELANDER.Wizard.RollChat.StartingAmmo"),
    ...context,
  });
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

export async function ammoQuantityOverrideFromRoll(
  formula: string,
  context?: WizardRollContext,
): Promise<Record<string, unknown>> {
  return ammoQuantityOverride(await rollFalloutAmmoQuantity(formula, context));
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
