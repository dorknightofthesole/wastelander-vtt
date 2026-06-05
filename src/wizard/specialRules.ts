import type { WizardState } from "./WizardState.js";
import {
  getSpecialAttributeMax,
  getSpecialAttributeMin,
  getSpecialBaseline,
  SPECIAL_KEYS,
  type OriginSpecialOverrides,
  type SpecialKey,
} from "./originRules.js";

export interface SpecialPointsBudget {
  total: number;
  spent: number;
  remaining: number;
}

export function computeSpecialPointsBudget(
  special: WizardState["special"],
  options: {
    originId: string | null;
    survivorTraitIds: string[];
    originPointBonus?: number;
    specialOverrides?: OriginSpecialOverrides;
  },
): SpecialPointsBudget {
  const overrides = options.specialOverrides ?? {};

  const spent = SPECIAL_KEYS.reduce(
    (sum, key) => sum + Math.max(0, special[key] - getSpecialBaseline(key, overrides)),
    0,
  );

  const refunds = SPECIAL_KEYS.reduce(
    (sum, key) => sum + (special[key] === 4 ? 1 : 0),
    0,
  );

  let originBonus = Number(options.originPointBonus ?? 0) || 0;
  if (options.originId === "survivor" && options.survivorTraitIds.includes("gifted")) {
    originBonus += 2;
  }

  const total = 5 + refunds + originBonus;
  const remaining = total - spent;
  return { total, spent, remaining };
}

/** Decrement always allowed down to 4; increment only if the pool can afford it. */
export function canSetSpecialValue(
  special: WizardState["special"],
  attr: SpecialKey,
  next: number,
  budgetOptions: Parameters<typeof computeSpecialPointsBudget>[1],
  specialOverrides: OriginSpecialOverrides = {},
): boolean {
  const current = special[attr];
  const min = getSpecialAttributeMin(attr, specialOverrides);
  const max = getSpecialAttributeMax(attr, specialOverrides);
  if (next === current) return true;
  if (next < min || next > max) return false;
  if (next < current) return true;

  const trial = { ...special, [attr]: next };
  return (
    computeSpecialPointsBudget(trial, {
      ...budgetOptions,
      specialOverrides,
    }).remaining >= 0
  );
}

export function clampSpecialValue(
  attr: SpecialKey,
  next: number,
  specialOverrides: OriginSpecialOverrides = {},
): number {
  const min = getSpecialAttributeMin(attr, specialOverrides);
  const max = getSpecialAttributeMax(attr, specialOverrides);
  return Math.max(min, Math.min(max, Math.trunc(next)));
}
