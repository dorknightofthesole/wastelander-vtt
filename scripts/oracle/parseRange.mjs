/**
 * Parse PDF result notation into Foundry roll table range pairs.
 */

/**
 * @param {string | [number, number]} input - e.g. "1-20", "51+", [21, 23]
 * @param {{ rollMax?: number }} [options]
 * @returns {[number, number]}
 */
export function parseRange(input, options = {}) {
  if (Array.isArray(input) && input.length === 2) {
    const low = Number(input[0]);
    const high = Number(input[1]);
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      throw new Error(`Invalid range array: ${JSON.stringify(input)}`);
    }
    return [low, high];
  }

  const text = String(input ?? "").trim();
  if (!text) throw new Error("Empty range");

  const plusMatch = /^(\d+)\+$/.exec(text);
  if (plusMatch) {
    const low = Number(plusMatch[1]);
    const rollMax = Number(options.rollMax ?? 100);
    return [low, rollMax];
  }

  const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(text);
  if (rangeMatch) {
    return [Number(rangeMatch[1]), Number(rangeMatch[2])];
  }

  const single = Number(text);
  if (Number.isFinite(single)) {
    return [single, single];
  }

  throw new Error(`Unrecognized range: "${text}"`);
}

/** Standard Foundry die sizes used for oracle roll tables. */
const STANDARD_DIE_FACES = [4, 6, 8, 10, 12, 20, 40, 100];

/**
 * @param {string} formula
 * @returns {{ min: number, max: number } | null}
 */
export function rollSpaceForFormula(formula) {
  const match = /^(\d+)d(\d+)$/i.exec(String(formula ?? "").trim());
  if (!match) return null;
  const dice = Number(match[1]);
  const faces = Number(match[2]);
  if (!Number.isFinite(dice) || !Number.isFinite(faces) || dice < 1 || faces < 1) {
    return null;
  }
  return { min: dice, max: dice * faces };
}

/**
 * Smallest standard dice formula whose maximum roll covers `entryCount` rows.
 * Prefers fewer dice, then smaller face count, then tighter maximum roll.
 *
 * @param {number} entryCount
 * @returns {string}
 */
export function suggestStandardFormula(entryCount) {
  const n = Math.max(1, Math.floor(entryCount));
  /** @type {{ dice: number, faces: number, max: number } | null} */
  let best = null;

  for (let dice = 1; dice <= Math.max(1, Math.ceil(n / 4)); dice++) {
    for (const faces of STANDARD_DIE_FACES) {
      const max = dice * faces;
      if (max < n) continue;
      const candidate = { dice, faces, max };
      if (!best) {
        best = candidate;
        continue;
      }
      if (candidate.dice < best.dice) best = candidate;
      else if (candidate.dice === best.dice && candidate.faces < best.faces) {
        best = candidate;
      } else if (
        candidate.dice === best.dice &&
        candidate.faces === best.faces &&
        candidate.max < best.max
      ) {
        best = candidate;
      }
    }
  }

  if (!best) {
    const dice = Math.ceil(n / 100);
    return `${dice}d100`;
  }
  return `${best.dice}d${best.faces}`;
}

/**
 * @param {Array<{ range: [number, number] | string }>} results
 * @param {{ rollMax?: number }} [options]
 */
export function isSequentialUnitRanges(results, options = {}) {
  for (let i = 0; i < results.length; i++) {
    const [low, high] = parseRange(results[i].range, {
      rollMax: options.rollMax,
    });
    if (low !== i + 1 || high !== i + 1) return false;
  }
  return results.length > 0;
}

/**
 * @param {Array<{ range: [number, number] | string }>} results
 * @param {{ rollMin?: number, rollMax?: number }} [options]
 * @returns {string}
 */
export function deriveFormula(results, options = {}) {
  let min = options.rollMin;
  let max = options.rollMax;

  for (const row of results) {
    const [low, high] = parseRange(row.range, { rollMax: options.rollMax });
    if (min === undefined || low < min) min = low;
    if (max === undefined || high > max) max = high;
  }

  if (min === undefined || max === undefined) {
    throw new Error("Cannot derive formula from empty results");
  }

  if (
    min === 1 &&
    max === results.length &&
    isSequentialUnitRanges(results, options)
  ) {
    return suggestStandardFormula(max);
  }

  return `${min}d${max}`;
}
