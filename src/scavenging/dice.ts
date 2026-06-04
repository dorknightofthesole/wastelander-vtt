import { evaluateFoundryRoll } from "../integrations/foundryRoll.js";

/** Roll one or more dice with the given number of sides. */
export function rollDie(
  sides: number,
  count = 1,
): { faces: number[]; sum: number } {
  const n = Math.max(1, Math.floor(sides));
  const faces: number[] = [];
  for (let i = 0; i < count; i++) {
    faces.push(Math.floor(Math.random() * n) + 1);
  }
  return { faces, sum: faces.reduce((a, b) => a + b, 0) };
}

/** Roll one or more d20; returns faces and sum. */
export function rollD20(count: number): { faces: number[]; sum: number } {
  return rollDie(20, count);
}

/** Roll 2d20; returns faces and sum (used for loot table index). */
export function roll2d20(): { faces: number[]; sum: number } {
  return rollD20(2);
}

export function roll3d20(): { faces: number[]; sum: number } {
  return rollD20(3);
}

export type CombatDiceRollResult = {
  faces: number[];
  sum: number;
  effects: number;
  formula: string;
  roll?: Roll;
};

type DieTerm = {
  denomination?: string | number;
  faces?: number;
  results?: Array<{ result: number; active?: boolean }>;
};

function isDieTerm(term: unknown): term is DieTerm {
  return (
    typeof term === "object" &&
    term !== null &&
    "results" in term &&
    Array.isArray((term as DieTerm).results)
  );
}

function getRollDice(roll: Roll): DieTerm[] {
  const rollDice = roll.dice;
  if (rollDice?.length) return rollDice;
  return (roll.terms ?? []).filter(isDieTerm);
}

/** Fallout registers combat dice as denomination `c` (formula: `5dc`). */
function isCombatDieTerm(term: DieTerm, formula: string): boolean {
  const denom = String(term.denomination ?? "").toLowerCase();
  if (denom === "c") return true;
  if (denom === "20") return false;
  return formula.includes("dc") && (term.faces === 6 || term.faces === undefined);
}

/** Sum one Fallout combat die face (DieFalloutDamage values). */
function falloutCombatDieFaceValue(face: number): number {
  if (face <= 2) return face;
  if (face >= 5) return 1;
  return 0;
}

function collectCombatDiceResults(
  roll: Roll,
  formula: string,
): { faces: number[]; effects: number; sumFromFaces: number } {
  const faces: number[] = [];
  let effects = 0;
  let sumFromFaces = 0;

  const consume = (results: DieTerm["results"]): void => {
    for (const r of results ?? []) {
      if (r.active === false) continue;
      faces.push(r.result);
      sumFromFaces += falloutCombatDieFaceValue(r.result);
      if (r.result >= 5) effects += 1;
    }
  };

  for (const term of roll.terms ?? []) {
    if (!isDieTerm(term) || !isCombatDieTerm(term, formula)) continue;
    consume(term.results);
  }

  if (faces.length === 0) {
    for (const die of getRollDice(roll)) {
      if (!isCombatDieTerm(die, formula)) continue;
      consume(die.results);
    }
  }

  return { faces, effects, sumFromFaces };
}

function parseCombatDiceRoll(roll: Roll, formula: string): CombatDiceRollResult {
  const { faces, effects, sumFromFaces } = collectCombatDiceResults(roll, formula);

  const evaluatedTotal = Number(roll.total);
  const sum =
    Number.isFinite(evaluatedTotal) && (evaluatedTotal > 0 || faces.length === 0)
      ? Math.floor(evaluatedTotal)
      : sumFromFaces;

  return { faces, sum, effects, formula, roll };
}

/**
 * Roll N combat dice via Foundry (`Ndc`) so the Fallout system RNG and dice apply.
 */
export async function rollCombatDice(
  count: number,
  options?: { animate?: boolean },
): Promise<CombatDiceRollResult> {
  if (count <= 0) {
    return { faces: [], sum: 0, effects: 0, formula: "0dc" };
  }

  const formula = `${count}dc`;
  const roll = await evaluateFoundryRoll(formula, { animate: options?.animate });

  return parseCombatDiceRoll(roll, formula);
}

export async function evaluateFormula(formula: string): Promise<{
  total: number;
  faces: number[];
  effects: number;
}> {
  const normalized = formula.replace(/\s+/g, "").toLowerCase();
  const roll = await evaluateFoundryRoll(normalized, { animate: false });
  const parsed = parseCombatDiceRoll(roll, normalized);
  return {
    total: parsed.sum,
    faces: parsed.faces,
    effects: parsed.effects,
  };
}
