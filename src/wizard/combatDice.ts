/**
 * Fallout Core Rulebook — Combat Dice Results (p.31).
 * Roll a d6 and map the face using this table (not the raw die result).
 */
export const COMBAT_DICE_D6_RESULTS: Readonly<Record<number, number>> = {
  1: 1,
  2: 2,
  3: 0,
  4: 0,
  5: 1,
  6: 1,
};

export function rollD6(): number {
  return Math.floor(Math.random() * 6) + 1;
}

/** Damage/count value for one d6 after Combat Dice conversion. */
export function combatDiceValueFromD6(face: number): number {
  return COMBAT_DICE_D6_RESULTS[face] ?? 0;
}

/** Roll `count` combat dice (each: d6 → table lookup) and return the total. */
export function rollCombatDicePool(count: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += combatDiceValueFromD6(rollD6());
  }
  return total;
}
