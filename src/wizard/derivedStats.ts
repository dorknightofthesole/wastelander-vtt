import { isMisterHandyOrigin } from "./originRules.js";
import type { WizardState } from "./WizardState.js";

export interface DerivedStatistics {
  carryWeight: number;
  carryWeightFormula: string;
  defense: number;
  initiative: number;
  initiativeFormula: string;
  healthPoints: number;
  healthPointsFormula: string;
  meleeDamageBonus: number;
  meleeDamageLabel: string;
}

export function computeDerivedStatistics(state: WizardState): DerivedStatistics {
  const { str, per, end, agi, luc } = state.special;
  const smallFrame = state.survivorTraitIds.includes("small-frame");

  let carryWeight = 150 + str * 10;
  let carryWeightFormula = `150 + (STR ${str} × 10) = ${carryWeight} lbs.`;
  if (isMisterHandyOrigin(state.originId)) {
    carryWeight = 150;
    carryWeightFormula = "150 lbs. (fixed — Mister Handy robot)";
  } else if (smallFrame) {
    carryWeight = 150 + str * 5;
    carryWeightFormula = `150 + (STR ${str} × 5) = ${carryWeight} lbs. (Small Frame)`;
  }

  const defense = agi >= 9 ? 2 : 1;
  const initiative = per + agi;
  const healthPoints = end + luc;

  let meleeDamageBonus = 0;
  let meleeDamageLabel = "None (STR 6 or less)";
  if (str >= 11) {
    meleeDamageBonus = 3;
    meleeDamageLabel = "+3 CD (STR 11+)";
  } else if (str >= 9) {
    meleeDamageBonus = 2;
    meleeDamageLabel = "+2 CD (STR 9–10)";
  } else if (str >= 7) {
    meleeDamageBonus = 1;
    meleeDamageLabel = "+1 CD (STR 7–8)";
  }

  return {
    carryWeight,
    carryWeightFormula,
    defense,
    initiative,
    initiativeFormula: `PER ${per} + AGI ${agi} = ${initiative}`,
    healthPoints,
    healthPointsFormula: `END ${end} + LCK ${luc} = ${healthPoints}`,
    meleeDamageBonus,
    meleeDamageLabel,
  };
}

export function formatDerivedStatisticsForDisplay(
  stats: DerivedStatistics,
): Array<{ label: string; value: string }> {
  return [
    { label: "Carry weight", value: stats.carryWeightFormula },
    { label: "Defense", value: String(stats.defense) },
    { label: "Initiative", value: stats.initiativeFormula },
    { label: "Health points", value: stats.healthPointsFormula },
    { label: "Melee damage bonus", value: stats.meleeDamageLabel },
  ];
}
