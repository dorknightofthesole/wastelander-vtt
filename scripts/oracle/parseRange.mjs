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

  return `${min}d${max}`;
}
