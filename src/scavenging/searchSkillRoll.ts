import { readActorSpecial } from "../export/actorDerivedStats.js";
import type { FalloutActorSystemSlice } from "../export/actorDerivedStats.js";
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

function getSkillValue(actor: Actor, skillName: string): number {
  const item = actor.items.find(
    (i) => i.type === "skill" && i.name.toLowerCase() === skillName.toLowerCase(),
  );
  if (!item) return 0;
  const system = item.system as { value?: number; rank?: number };
  const value = Number(system.value ?? system.rank ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function count2d20Successes(faces: number[], targetNumber: number): number {
  let successes = 0;
  for (const face of faces) {
    if (face === 1) successes += 2;
    else if (face <= targetNumber) successes += 1;
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
  const system = actor.system as FalloutActorSystemSlice;
  const { per } = readActorSpecial(system);
  const survival = getSkillValue(actor, "Survival");
  const targetNumber = per + survival;
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
