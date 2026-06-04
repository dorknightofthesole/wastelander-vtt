import degreeData from "../data/scavenging/creation/degree-reduction.json";
import type { LocationDegree, LocationScale } from "./ScavengerLocation.js";
import { rollCombatDice } from "./dice.js";

const DEGREE_LABELS = degreeData.degrees as Record<
  LocationDegree,
  { label: string; minimumsReducedTiny: number }
>;

export const SEARCH_TIME_BY_SCALE: Record<
  LocationScale,
  { label: string; minutes: number }
> = {
  tiny: { label: "A safe", minutes: 1 },
  small: { label: "A room", minutes: 10 },
  average: { label: "A small shop or home, or several rooms", minutes: 30 },
  large: { label: "A large multi-story building, or several shops or homes", minutes: 120 },
};

export function getScaleMultiplier(scale: LocationScale): number {
  const map: Record<LocationScale, number> = {
    tiny: 1,
    small: 2,
    average: 3,
    large: 4,
  };
  return map[scale];
}

/** Booklet: item minimums reduced (tiny) × scale multiplier. */
export function getDegreeReductionPoints(
  degree: LocationDegree,
  scale: LocationScale,
): { tinyReduced: number; scaleMultiplier: number; total: number; degreeLabel: string } {
  const def = DEGREE_LABELS[degree];
  const tinyReduced = def.minimumsReducedTiny;
  const scaleMultiplier = getScaleMultiplier(scale);
  return {
    tinyReduced,
    scaleMultiplier,
    total: tinyReduced * scaleMultiplier,
    degreeLabel: def.label,
  };
}

export function getSearchDifficulty(degree: LocationDegree): number {
  const map: Record<LocationDegree, number> = {
    untouched: 0,
    partly: 1,
    mostly: 2,
    heavily: 3,
  };
  return map[degree];
}

export function getObstacleDifficulty(locationLevel: number): number {
  let diff = 1;
  if (locationLevel >= 6) diff += 1;
  if (locationLevel >= 11) diff += 1;
  if (locationLevel >= 16) diff += 1;
  if (locationLevel >= 21) diff += 1;
  return Math.min(5, diff);
}

export function getOccasionalHazardDamageDc(locationLevel: number): number {
  return 3 + Math.floor(locationLevel / 4);
}

/**
 * GM Screen Booklet p.19: roll DC equal to sum of PCs' levels, plus DC from
 * degree of search; total is location level. Each Effect on those DC adds +1
 * if the location has problems (obstacle, hazard, or inhabitants).
 */
export async function rollLocationLevel(params: {
  partyLevelSum: number;
  degreeExtraDc: number;
  hasProblems: boolean;
  /** Show combat dice in Dice So Nice (default true). */
  animate?: boolean;
}): Promise<{
  level: number;
  dcCount: number;
  dcRoll: Awaited<ReturnType<typeof rollCombatDice>>;
  bonusFromEffects: number;
}> {
  const dcCount = params.partyLevelSum + params.degreeExtraDc;
  if (dcCount <= 0) {
    const empty = {
      faces: [] as number[],
      sum: 0,
      effects: 0,
      formula: "0dc",
    };
    return { level: 0, dcCount: 0, dcRoll: empty, bonusFromEffects: 0 };
  }
  const dcRoll = await rollCombatDice(dcCount, { animate: params.animate });
  let level = dcRoll.sum;
  const bonusFromEffects = params.hasProblems ? dcRoll.effects : 0;
  level += bonusFromEffects;
  return { level, dcCount, dcRoll, bonusFromEffects };
}
