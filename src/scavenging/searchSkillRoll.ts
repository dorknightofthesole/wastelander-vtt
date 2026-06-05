import { evaluateFoundryRoll } from "../integrations/foundryRoll.js";
import { presentScavengerRoll } from "./scavengerRollChat.js";
import { rollD20 } from "./dice.js";

export type SkillTestResult = {
  targetNumber: number;
  difficulty: number;
  faces: number[];
  successes: number;
  success: boolean;
  formula: string;
  roll?: Roll;
  detail: string;
};

import {
  getPerSurvivalTargetNumber,
} from "./searchTeam.js";

export function countDieSuccesses(face: number, targetNumber: number): number {
  if (face === 1) return 2;
  if (face <= targetNumber) return 1;
  return 0;
}

function count2d20Successes(faces: number[], targetNumber: number): number {
  let successes = 0;
  for (const face of faces) {
    successes += countDieSuccesses(face, targetNumber);
  }
  return successes;
}

/**
 * PER + Survival vs location search difficulty (2d20 skill test).
 */
export async function rollPerSurvivalSearch(
  actor: Actor,
  difficulty: number,
  options?: { animate?: boolean },
): Promise<SkillTestResult> {
  const { per, survival, targetNumber } = getPerSurvivalTargetNumber(actor);
  const formula = "2d20";

  let faces: number[] = [];
  let roll: Roll | undefined;

  try {
    roll = await evaluateFoundryRoll(formula, { animate: false });
    const dice = roll.dice ?? [];
    for (const die of dice) {
      for (const r of die.results ?? []) {
        if (r.active !== false) faces.push(r.result);
      }
    }
    if (faces.length < 2) {
      const terms = roll.terms ?? [];
      for (const term of terms) {
        if (
          typeof term === "object" &&
          term !== null &&
          "results" in term &&
          Array.isArray((term as { results: Array<{ result: number; active?: boolean }> }).results)
        ) {
          for (const r of (term as { results: Array<{ result: number; active?: boolean }> })
            .results) {
            if (r.active !== false) faces.push(r.result);
          }
        }
      }
    }
  } catch {
    const local = rollD20(2);
    faces = local.faces;
  }

  if (faces.length < 2) {
    const local = rollD20(2);
    faces = local.faces;
  }

  const successes = count2d20Successes(faces, targetNumber);
  const success = successes >= difficulty;
  const detail = `PER ${per} + Survival ${survival} = TN ${targetNumber}; rolled [${faces.join(", ")}] → ${successes} success(es) vs diff ${difficulty}`;

  if (options?.animate !== false && roll) {
    await presentScavengerRoll({
      roll,
      formula,
      label: "Search (PER + Survival)",
      total: successes,
      detail,
    });
  }

  return {
    targetNumber,
    difficulty,
    faces,
    successes,
    success,
    formula,
    roll,
    detail,
  };
}

/** Assist search: one d20 vs PER+Survival TN (contributes +1 success when primary also passes). */
export async function rollAssistPerSurvival(
  actor: Actor,
  options?: { animate?: boolean },
): Promise<SkillTestResult & { contributesSuccess: boolean }> {
  const { per, survival, targetNumber } = getPerSurvivalTargetNumber(actor);
  const formula = "1d20";

  let face = 0;
  let roll: Roll | undefined;

  try {
    roll = await evaluateFoundryRoll(formula, { animate: false });
    const dice = roll.dice ?? [];
    for (const die of dice) {
      for (const r of die.results ?? []) {
        if (r.active !== false) face = r.result;
      }
    }
    if (!face) {
      const terms = roll.terms ?? [];
      for (const term of terms) {
        if (
          typeof term === "object" &&
          term !== null &&
          "results" in term &&
          Array.isArray((term as { results: Array<{ result: number; active?: boolean }> }).results)
        ) {
          const active = (term as { results: Array<{ result: number; active?: boolean }> })
            .results.find((r) => r.active !== false);
          if (active) face = active.result;
        }
      }
    }
  } catch {
    face = rollD20(1).faces[0] ?? 1;
  }

  if (!face) {
    face = rollD20(1).faces[0] ?? 1;
  }

  const successes = countDieSuccesses(face, targetNumber);
  const contributesSuccess = successes >= 1;
  const detail = `Assist: PER ${per} + Survival ${survival} = TN ${targetNumber}; rolled [${face}] → ${successes} success(es)${contributesSuccess ? " (helps primary)" : ""}`;

  if (options?.animate !== false && roll) {
    await presentScavengerRoll({
      roll,
      formula,
      label: "Assist search (PER + Survival)",
      total: successes,
      detail,
    });
  }

  return {
    targetNumber,
    difficulty: 0,
    faces: [face],
    successes,
    success: contributesSuccess,
    formula,
    roll,
    detail,
    contributesSuccess,
  };
}
