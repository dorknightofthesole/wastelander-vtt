import { evaluateFoundryRoll } from "../integrations/foundryRoll.js";
import { presentScavengerRoll } from "./scavengerRollChat.js";
import { rollD20 } from "./dice.js";
import { getPerSurvivalTargetNumber } from "./searchTeam.js";

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

export function countDieSuccesses(face: number, targetNumber: number): number {
  if (face === 1) return 2;
  if (face <= targetNumber) return 1;
  return 0;
}

/** Match Fallout Roller2D20 success counting (attribute + skill TN, optional tag crit). */
export function countFalloutD20Successes(
  faces: number[],
  attribute: number,
  skill: number,
  tag: boolean,
): number {
  const successThreshold = attribute + skill;
  const critThreshold = Math.max(tag ? skill : 1, 1);
  let successes = 0;
  for (const face of faces) {
    if (face <= successThreshold) successes += 1;
    if (face <= critThreshold) successes += 1;
  }
  return successes;
}

export type ClientPrimarySearchRoll = {
  faces: number[];
  successes: number;
  targetNumber: number;
  difficulty: number;
};

export type ClientAssistSearchRoll = {
  faces: number[];
  successes: number;
  targetNumber: number;
};

/** Validate a client-supplied primary roll from Fallout Dialog2d20. */
export function primarySearchFromClientRoll(
  actor: Actor,
  clientRoll: ClientPrimarySearchRoll,
): SkillTestResult | { error: string } {
  const { per, survival, targetNumber } = getPerSurvivalTargetNumber(actor);
  const skillItem = actor.items.find(
    (item) => item.type === "skill" && item.name.toLowerCase() === "survival",
  );
  const tag = Boolean((skillItem?.system as { tag?: boolean }).tag);

  if (clientRoll.targetNumber !== targetNumber) {
    return { error: "Primary search roll target number does not match the actor." };
  }
  if (!Number.isFinite(clientRoll.difficulty) || clientRoll.difficulty < 0) {
    return { error: "Invalid search difficulty." };
  }
  if (!Array.isArray(clientRoll.faces) || clientRoll.faces.length < 1 || clientRoll.faces.length > 5) {
    return { error: "Primary search roll must include 1–5 d20 results." };
  }
  if (clientRoll.faces.some((face) => !Number.isFinite(face) || face < 1 || face > 20)) {
    return { error: "Invalid d20 results in primary search roll." };
  }

  const recomputed = countFalloutD20Successes(clientRoll.faces, per, survival, tag);
  if (recomputed !== clientRoll.successes) {
    return { error: "Primary search roll success count does not match the dice." };
  }

  const difficulty = clientRoll.difficulty;
  const success = clientRoll.successes >= difficulty;
  const detail = `PER ${per} + Survival ${survival} = TN ${targetNumber}; rolled [${clientRoll.faces.join(", ")}] → ${clientRoll.successes} success(es) vs diff ${difficulty}`;

  return {
    targetNumber,
    difficulty,
    faces: clientRoll.faces,
    successes: clientRoll.successes,
    success,
    formula: `${clientRoll.faces.length}d20`,
    detail,
  };
}

/** Validate a client-supplied assist roll from Fallout Dialog2d20 (1d20). */
export function assistSearchFromClientRoll(
  actor: Actor,
  clientRoll: ClientAssistSearchRoll,
): (SkillTestResult & { contributesSuccess: boolean }) | { error: string } {
  const { per, survival, targetNumber } = getPerSurvivalTargetNumber(actor);
  const skillItem = actor.items.find(
    (item) => item.type === "skill" && item.name.toLowerCase() === "survival",
  );
  const tag = Boolean((skillItem?.system as { tag?: boolean }).tag);

  if (clientRoll.targetNumber !== targetNumber) {
    return { error: "Assist search roll target number does not match the actor." };
  }
  if (!Array.isArray(clientRoll.faces) || clientRoll.faces.length < 1) {
    return { error: "Assist search roll must include at least one d20 result." };
  }
  const face = clientRoll.faces[0]!;
  if (!Number.isFinite(face) || face < 1 || face > 20) {
    return { error: "Invalid d20 result in assist search roll." };
  }

  const recomputed = countFalloutD20Successes([face], per, survival, tag);
  if (recomputed !== clientRoll.successes) {
    return { error: "Assist search roll success count does not match the die." };
  }

  const contributesSuccess = clientRoll.successes >= 1;
  const detail = `Assist: PER ${per} + Survival ${survival} = TN ${targetNumber}; rolled [${face}] → ${clientRoll.successes} success(es)${contributesSuccess ? " (helps primary)" : ""}`;

  return {
    targetNumber,
    difficulty: 0,
    faces: [face],
    successes: clientRoll.successes,
    success: contributesSuccess,
    formula: "1d20",
    detail,
    contributesSuccess,
  };
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
