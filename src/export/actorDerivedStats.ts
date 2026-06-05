import {
  computeHealthMax,
  computeStartingLuckPoints,
  type DerivedStatistics,
} from "../wizard/derivedStats.js";
import type { WizardState } from "../wizard/WizardState.js";

export type ActorSpecial = WizardState["special"];

export interface FalloutActorSystemSlice {
  attributes?: Record<
    string,
    { value?: number; current?: number } | undefined
  >;
  origin?: string;
  trait?: string;
  luckPoints?: number;
  level?: { value?: number; currentXP?: number; nextLevelXP?: number };
  health?: { value?: number; max?: number; bonus?: number };
  currency?: { caps?: number };
  radiation?: number;
  derived?: {
    carryWeight?: { value?: number; max?: number };
    conditions?: { wellRested?: boolean };
  };
  immunities?: Record<string, boolean | number>;
  body_parts?: Record<
    string,
    {
      resistance?: {
        physical?: number;
        energy?: number;
        radiation?: number;
        poison?: number;
      };
      hp?: { value?: number; max?: number };
    }
  >;
}

function readAttr(
  attributes: FalloutActorSystemSlice["attributes"],
  key: string,
): number {
  const row = attributes?.[key];
  if (!row || typeof row !== "object") return 0;
  const value = row.value ?? row.current;
  return Number(value ?? 0);
}

export function readActorSpecial(system: FalloutActorSystemSlice): ActorSpecial {
  return {
    str: readAttr(system.attributes, "str"),
    per: readAttr(system.attributes, "per"),
    end: readAttr(system.attributes, "end"),
    cha: readAttr(system.attributes, "cha"),
    int: readAttr(system.attributes, "int"),
    agi: readAttr(system.attributes, "agi"),
    luc: readAttr(system.attributes, "luc"),
  };
}

export function hasSurvivorTraitGifted(actor: Actor): boolean {
  return actor.items.some((item) => {
    if (item.type !== "trait") return false;
    const name = item.name.toLowerCase();
    return name.includes("gifted");
  });
}

export function computeActorDerivedStatistics(
  actor: Actor,
  system: FalloutActorSystemSlice,
): DerivedStatistics {
  const special = readActorSpecial(system);
  const level = Number(system.level?.value ?? 1);
  const radiation = Number(system.radiation ?? 0);
  const healthBonus = Number(system.health?.bonus ?? 0);
  const wellRestedOrTinkered = Boolean(
    system.derived?.conditions?.wellRested,
  );

  const survivorTraitIds = hasSurvivorTraitGifted(actor) ? ["gifted"] : [];

  const { str, per, end, agi, luc } = special;
  const smallFrame = actor.items.some(
    (item) =>
      item.type === "trait" &&
      item.name.toLowerCase().includes("small frame"),
  );
  const robot = actor.type === "robot";

  let carryWeight = 150 + str * 10;
  let carryWeightFormula = `150 + (STR ${str} × 10) = ${carryWeight} lbs.`;
  if (robot) {
    carryWeight = 150;
    carryWeightFormula = "150 lbs. (robot)";
  } else if (smallFrame) {
    carryWeight = 150 + str * 5;
    carryWeightFormula = `150 + (STR ${str} × 5) = ${carryWeight} lbs. (Small Frame)`;
  }

  const defense = agi >= 9 ? 2 : 1;
  const initiative = per + agi;
  const healthPoints = computeHealthMax(special, {
    level,
    radiation,
    healthBonus,
    wellRestedOrTinkered,
  });
  const luckPoints =
    Number(system.luckPoints ?? NaN) ||
    computeStartingLuckPoints(special, survivorTraitIds);

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
    luckPoints,
    luckPointsFormula: `LCK ${luc} = ${luckPoints}`,
    meleeDamageBonus,
    meleeDamageLabel,
  };
}

export function formatMeleeDamageForPdf(stats: DerivedStatistics): string {
  if (stats.meleeDamageBonus <= 0) return stats.meleeDamageLabel;
  return stats.meleeDamageLabel;
}
