import { parseRange } from "./parseRange.mjs";
import {
  groupItemsByRow,
  itemsByBand,
  joinBandText,
  normalizeText,
  sliceTableRegion,
} from "./pdfText.mjs";

/**
 * @param {import('./pdfText.mjs').TextItem[]} items
 * @param {string} heading
 */
function findHeadingIndexInItems(items, heading) {
  const target = normalizeText(heading).toLowerCase();
  for (let i = 0; i < items.length; i++) {
    const chunk = normalizeText(
      items
        .slice(i, i + 8)
        .map((it) => it.text)
        .join(" "),
    ).toLowerCase();
    if (chunk.includes(target)) return i;
  }
  return -1;
}

const RANGE_RE = /^(\d+)(?:\s*-\s*(\d+))?\+?$/;
const BAND_RANGE_RE = /^(\d+)\s*-\s*(\d+)$/;
const PLUS_RANGE_RE = /^(\d+)\+$/;

/**
 * @param {string} text
 */
function parseRangeToken(text) {
  const t = normalizeText(text);
  const plus = PLUS_RANGE_RE.exec(t);
  if (plus) return `${plus[1]}+`;
  const band = BAND_RANGE_RE.exec(t);
  if (band) return `${band[1]}-${band[2]}`;
  const single = /^(\d+)$/.exec(t);
  if (single) return single[1];
  return null;
}

/**
 * @param {string} range
 * @param {Record<string, unknown>} profile
 */
function isPlausibleRange(range, profile) {
  if (!range || /^(RESULT|NAME|EFFECT)$/i.test(range)) return false;
  const rollMax = Number(profile.rollMax ?? 100);
  const rollMin = Number(profile.rollMin ?? 1);
  if (range.includes("-") || range.endsWith("+")) return true;
  const n = Number(range);
  if (!Number.isFinite(n)) return false;
  return n >= rollMin && n <= rollMax;
}

/**
 * @param {Array<{ range: string, name: string, description?: string }>} results
 * @param {Record<string, unknown>} profile
 * @returns {string[]}
 */
function collectWarnings(results, profile) {
  /** @type {string[]} */
  const warnings = [];
  const layout = String(profile.layout);
  const rollMax = profile.rollMax != null ? Number(profile.rollMax) : null;
  const rollMin = profile.rollMin != null ? Number(profile.rollMin) : null;

  const seen = new Set();
  for (const row of results) {
    if (seen.has(row.range)) warnings.push(`duplicate range: ${row.range}`);
    seen.add(row.range);
    if (!row.name || row.name.length < 2) {
      warnings.push(`short name for range ${row.range}`);
    }
    if (/fallout|wasteland wanderer/i.test(row.name)) {
      warnings.push(`footer bleed in range ${row.range}`);
    }
  }

  if (rollMin != null && rollMax != null) {
    if (layout === "twoColumnD20" || layout === "nameEqualsDescription") {
      if (results.length < rollMax - rollMin + 1) {
        warnings.push(
          `expected ${rollMax - rollMin + 1} rows, got ${results.length}`,
        );
      }
    }
    if (layout === "singleColumn" && rollMax === 100) {
      if (results.length < 10) {
        warnings.push(`only ${results.length} banded rows (expected ~12)`);
      }
    }
    if (layout === "threeColumnSum" && results.length < 30) {
      warnings.push(`only ${results.length} loot rows (expected up to 39)`);
    }
    if (layout === "bandedRows" && rollMax === 20 && results.length < 15) {
      warnings.push(`only ${results.length} banded rows (expected ~20)`);
    }
  }

  try {
    const covered = new Set();
    for (const row of results) {
      const [low, high] = parseRange(row.range, { rollMax: rollMax ?? 100 });
      for (let n = low; n <= high; n++) covered.add(n);
    }
    if (rollMin != null && rollMax != null && layout !== "goalSubTable") {
      const missing = [];
      for (let n = rollMin; n <= rollMax; n++) {
        if (!covered.has(n)) missing.push(n);
      }
      if (missing.length && missing.length <= 10) {
        warnings.push(`missing roll values: ${missing.join(", ")}`);
      } else if (missing.length > 10) {
        warnings.push(`missing ${missing.length} roll values in [${rollMin},${rollMax}]`);
      }
    }
  } catch {
    warnings.push("could not validate roll coverage");
  }

  return warnings;
}

/**
 * @param {string} text
 */
function nameBeforeColon(text) {
  const idx = text.indexOf(":");
  if (idx < 0) return { name: text, description: "" };
  return {
    name: normalizeText(text.slice(0, idx)),
    description: normalizeText(text.slice(idx + 1)),
  };
}

/**
 * @param {string} text
 */
function splitTruthColon(text) {
  const idx = text.indexOf(":");
  if (idx < 0) return { name: text, description: text };
  return {
    name: normalizeText(text.slice(0, idx)),
    description: normalizeText(text.slice(idx + 1)),
  };
}

/**
 * @param {import('./pdfText.mjs').TextItem[]} region
 * @param {Record<string, unknown>} profile
 */
function parseSingleColumnNameEffect(region, profile) {
  const bands = /** @type {Record<string, [number, number]>} */ (
    profile.xBands ?? {
      range: [35, 75],
      name: [76, 147],
      effect: [148, 520],
    }
  );
  const byBand = itemsByBand(region, bands);
  const rangeRows = groupItemsByRow(byBand.range ?? [], 8);
  /** @type {Array<{ range: string, name: string, description: string }>} */
  const results = [];

  for (const row of rangeRows) {
    const rangeText = joinBandText(row);
    const range = parseRangeToken(rangeText);
    if (!range) continue;
    const y = row[0]?.y;
    const nameItems = (byBand.name ?? []).filter((it) => Math.abs(it.y - y) <= 14);
    const effectItems = (byBand.effect ?? []).filter(
      (it) => it.y <= y + 8 && it.y >= y - 45,
    );
    const name = joinBandText(nameItems);
    const description = joinBandText(effectItems);
    if (!name || /^(RESULT|NAME|EFFECT)$/i.test(name)) continue;
    if (!isPlausibleRange(range, profile)) continue;
    if (/fallout|wasteland wanderer/i.test(name)) continue;
    results.push({ range, name, description });
  }
  return results;
}

/**
 * @param {import('./pdfText.mjs').TextItem[]} region
 * @param {Record<string, unknown>} profile
 */
function parseNameEqualsTwoColumn(region, profile) {
  const bands = /** @type {Record<string, [number, number]>} */ (
    profile.xBands ?? {
      resultL: [45, 70],
      labelL: [75, 210],
      resultR: [225, 250],
      labelR: [255, 520],
    }
  );
  const byBand = itemsByBand(region, bands);
  const leftNums = groupItemsByRow(byBand.resultL ?? [], 6);
  const rightNums = groupItemsByRow(byBand.resultR ?? [], 6);

  /** @type {Array<{ range: string, name: string }>} */
  const results = [];

  function resultNumberFromRow(row) {
    const digits = [...row]
      .sort((a, b) => a.x - b.x)
      .map((it) => it.text.trim())
      .join("")
      .replace(/\s/g, "");
    const m = /^(\d+)$/.exec(digits);
    return m ? Number(m[1]) : null;
  }

  function addPair(numRow, labelBand, minN = 1, maxN = 20) {
    const n = resultNumberFromRow(numRow);
    if (n == null || n < minN || n > maxN) return;
    const y = numRow[0].y;
    const labelItems = labelBand.filter((it) => Math.abs(it.y - y) <= 8);
    const name = joinBandText(labelItems);
    if (!name || /^(RESULT|LOCATION|CONDITION|QUANTITY|SUPPLY|GOAL|FACTION)/i.test(name)) {
      return;
    }
    results.push({ range: String(n), name });
  }

  for (const row of leftNums) addPair(row, byBand.labelL ?? [], 1, 10);
  for (const row of rightNums) addPair(row, byBand.labelR ?? [], 11, 20);

  return results.sort(
    (a, b) => Number(parseRangeToken(a.range)) - Number(parseRangeToken(b.range)),
  );
}

/**
 * @param {import('./pdfText.mjs').TextItem[]} region
 * @param {Record<string, unknown>} profile
 */
function parseTwoColumnD20Encounter(region, profile) {
  const bands = /** @type {Record<string, [number, number]>} */ (
    profile.xBands ?? {
      resultL: [45, 60],
      bodyL: [70, 210],
      resultR: [225, 240],
      bodyR: [250, 520],
    }
  );
  const byBand = itemsByBand(region, bands);

  function extractCells(resultBand, bodyBand) {
    const nums = [...(byBand[resultBand] ?? [])].sort((a, b) => b.y - a.y);
    /** @type {Array<{ n: number, y: number }>} */
    const anchors = [];
    for (const it of nums) {
      const m = /^(\d+)$/.exec(normalizeText(it.text));
      if (m) anchors.push({ n: Number(m[1]), y: it.y });
    }
    anchors.sort((a, b) => a.n - b.n);
    /** @type {Array<{ range: string, name: string, description: string }>} */
    const cells = [];
    for (let i = 0; i < anchors.length; i++) {
      const { n, y } = anchors[i];
      const yTop = y + 5;
      const yBottom = i < anchors.length - 1 ? anchors[i + 1].y - 3 : y - 120;
      const bodyItems = (byBand[bodyBand] ?? []).filter(
        (it) => it.y <= yTop && it.y >= yBottom,
      );
      const full = joinBandText(bodyItems);
      if (!full) continue;
      const { name, description } = nameBeforeColon(full);
      cells.push({
        range: String(n),
        name: name || full.slice(0, 40),
        description: description || full,
      });
    }
    return cells;
  }

  return [
    ...extractCells("resultL", "bodyL"),
    ...extractCells("resultR", "bodyR"),
  ].sort((a, b) => Number(a.range) - Number(b.range));
}

/**
 * @param {import('./pdfText.mjs').TextItem[]} region
 * @param {Record<string, unknown>} profile
 */
function parseTwoColumnTruth(region, profile) {
  const bands = /** @type {Record<string, [number, number]>} */ (
    profile.xBands ?? {
      resultL: [45, 70],
      cellL: [75, 210],
      resultR: [225, 250],
      cellR: [255, 520],
    }
  );
  const byBand = itemsByBand(region, bands);

  function extract(resultBand, cellBand, minN, maxN) {
    const nums = groupItemsByRow(byBand[resultBand] ?? [], 6);
    /** @type {Array<{ range: string, name: string, description: string }>} */
    const out = [];
    for (const row of nums) {
      const n = Number(normalizeText(row.map((it) => it.text).join("")));
      if (!Number.isFinite(n) || n < minN || n > maxN) continue;
      const y = row[0].y;
      const cellItems = (byBand[cellBand] ?? []).filter(
        (it) => Math.abs(it.y - y) <= 10 || (it.y < y && it.y > y - 35),
      );
      const text = joinBandText(cellItems);
      if (!text) continue;
      const { name, description } = splitTruthColon(text);
      out.push({ range: String(n), name, description });
    }
    return out;
  }

  return [
    ...extract("resultL", "cellL", 1, 10),
    ...extract("resultR", "cellR", 11, 20),
  ].sort((a, b) => Number(a.range) - Number(b.range));
}

/**
 * @param {import('./pdfText.mjs').TextItem[]} region
 */
function parseTwoColumnState(region) {
  const bands = {
    result: [38, 55],
    state: [56, 145],
    description: [146, 520],
  };
  const byBand = itemsByBand(region, bands);
  const nums = groupItemsByRow(byBand.result ?? [], 6);
  /** @type {Array<{ range: string, name: string, description: string }>} */
  const results = [];
  for (const row of nums) {
    const n = Number(normalizeText(joinBandText(row)));
    if (!Number.isFinite(n) || n < 1 || n > 20) continue;
    const y = row[0].y;
    const stateItems = (byBand.state ?? []).filter(
      (it) => Math.abs(it.y - y) <= 12 || (it.y < y && it.y > y - 20),
    );
    const descItems = (byBand.description ?? []).filter(
      (it) => it.y <= y + 5 && it.y >= y - 35,
    );
    const name = joinBandText(stateItems);
    const description = joinBandText(descItems);
    if (!name) continue;
    results.push({ range: String(n), name, description });
  }
  return results.sort((a, b) => Number(a.range) - Number(b.range));
}

/**
 * @param {import('./pdfText.mjs').TextItem[]} region
 * @param {'armor' | 'weapon'} column
 */
function parseTwoColumnMods(region, column) {
  const bands = {
    range: [38, 55],
    armor: [56, 200],
    weapon: [201, 520],
  };
  const byBand = itemsByBand(region, bands);
  const rangeRows = groupItemsByRow(byBand.range ?? [], 8);
  /** @type {Array<{ range: string, name: string, description: string }>} */
  const results = [];
  for (const row of rangeRows) {
    const range = parseRangeToken(joinBandText(row));
    if (!range) continue;
    const y = row[0].y;
    const colItems = (byBand[column] ?? []).filter(
      (it) => it.y <= y + 5 && it.y >= y - 40,
    );
    const text = joinBandText(colItems);
    if (!text) continue;
    const colon = text.indexOf(":");
    const name =
      colon > 0 ? normalizeText(text.slice(0, colon)) : text.split(".")[0];
    results.push({
      range,
      name: normalizeText(name),
      description: text,
    });
  }
  return results;
}

/**
 * @param {import('./pdfText.mjs').TextItem[]} region
 * @param {Record<string, unknown>} profile
 */
function parseBandedRows(region, profile) {
  const bands = /** @type {Record<string, [number, number]>} */ (
    profile.xBands ?? {
      range: [38, 80],
      primary: [81, 200],
      secondary: [201, 520],
    }
  );
  const byBand = itemsByBand(region, bands);
  const rangeRows = groupItemsByRow(byBand.range ?? [], 8);
  /** @type {Array<{ range: string, name: string, description?: string }>} */
  const results = [];

  for (const row of rangeRows) {
    const rowText = joinBandText(row);
    let range = parseRangeToken(rowText);
    if (!range) {
      const embedded = BAND_RANGE_RE.exec(rowText);
      if (embedded) range = `${embedded[1]}-${embedded[2]}`;
    }
    if (!range) continue;
    const y = row[0].y;
    const primary = joinBandText(
      (byBand.primary ?? []).filter((it) => it.y <= y + 5 && it.y >= y - 35),
    );
    const secondary = joinBandText(
      (byBand.secondary ?? []).filter((it) => it.y <= y + 5 && it.y >= y - 35),
    );
    if (!primary) continue;
    const entry = { range, name: primary };
    if (secondary && secondary !== primary) entry.description = secondary;
    results.push(entry);
  }
  return results;
}

/**
 * @param {import('./pdfText.mjs').TextItem[]} region
 */
function parseThreeColumnSum(region) {
  const bands = {
    result: [38, 55],
    col1: [56, 175],
    col2: [176, 295],
    col3: [296, 520],
  };
  const byBand = itemsByBand(region, bands);
  const allResults = new Set(
    [...(byBand.col1 ?? []), ...(byBand.col2 ?? []), ...(byBand.col3 ?? [])]
      .map((it) => it.text)
      .join(" "),
  );

  function parseCellItems(colItems) {
    const rows = groupItemsByRow(colItems, 10);
    /** @type {Array<{ range: string, name: string, description: string }>} */
    const cells = [];
    for (const row of rows) {
      const parts = row.map((it) => it.text.trim());
      const numIdx = parts.findIndex((p) => /^\d+$/.test(p));
      if (numIdx < 0) continue;
      const n = Number(parts[numIdx]);
      const rest = normalizeText(parts.filter((_, i) => i !== numIdx).join(" "));
      const valueMatch = /\bVALUE[:\s]*(\d+)\s*$/i.exec(rest);
      const value = valueMatch ? valueMatch[1] : null;
      let name = rest.replace(/\s*VALUE[:\s]*\d+\s*$/i, "").trim();
      if (!name) continue;
      cells.push({
        range: String(n),
        name,
        description: value ? `VALUE: ${value}` : "",
      });
    }
    return cells;
  }

  const results = [
    ...parseCellItems(byBand.col1 ?? []),
    ...parseCellItems(byBand.col2 ?? []),
    ...parseCellItems(byBand.col3 ?? []),
  ];

  const byRange = new Map();
  for (const r of results) {
    if (!byRange.has(r.range)) byRange.set(r.range, r);
  }
  return [...byRange.values()].sort(
    (a, b) => Number(a.range) - Number(b.range),
  );
}

/**
 * @param {import('./pdfText.mjs').TextItem[]} region
 */
function parseGoalSubTable(region) {
  let startIdx = 0;
  const headerIdx = findHeadingIndexInItems(region, "QUESTIONS");
  if (headerIdx >= 0) startIdx = headerIdx;
  const body = region.slice(startIdx);

  const bands = {
    range: [38, 55],
    goal: [56, 200],
    questions: [201, 520],
  };
  const byBand = itemsByBand(body, bands);
  const rangeRows = groupItemsByRow(byBand.range ?? [], 8);
  /** @type {Array<{ range: string, name: string, description: string }>} */
  const results = [];
  for (const row of rangeRows) {
    const range = parseRangeToken(joinBandText(row));
    if (!range) continue;
    const y = row[0].y;
    const goal = joinBandText(
      (byBand.goal ?? []).filter((it) => it.y <= y + 5 && it.y >= y - 30),
    );
    const questions = joinBandText(
      (byBand.questions ?? []).filter((it) => it.y <= y + 5 && it.y >= y - 40),
    );
    if (!goal) continue;
    const name = goal.length > 60 ? goal.slice(0, 57) + "..." : goal;
    const description = questions ? `${goal}\n\n${questions}` : goal;
    results.push({ range, name, description });
  }
  return results;
}

/**
 * @param {import('./pdfText.mjs').TextItem[]} region
 * @param {'odds' | 'evens'} column
 */
function parseDemeanorColumn(region, column) {
  const bands = {
    result: [38, 55],
    odds: [56, 140],
    evens: [141, 520],
  };
  const byBand = itemsByBand(region, bands);
  const nums = groupItemsByRow(byBand.result ?? [], 6);
  const labelBand = column === "odds" ? "odds" : "evens";
  /** @type {Array<{ range: string, name: string }>} */
  const results = [];
  for (const row of nums) {
    const n = Number(normalizeText(joinBandText(row)));
    if (!Number.isFinite(n) || n < 1 || n > 20) continue;
    const y = row[0].y;
    const label = joinBandText(
      (byBand[labelBand] ?? []).filter((it) => Math.abs(it.y - y) <= 8),
    );
    if (!label || /^(ODDS|EVENS|RESULT)$/i.test(label)) continue;
    results.push({ range: String(n), name: label });
  }
  return results;
}

/**
 * @param {import('./pdfText.mjs').TextItem[]} region
 */
function parseNpcSecret(region) {
  const bands = { range: [38, 55], secret: [56, 520] };
  const byBand = itemsByBand(region, bands);
  const rangeRows = groupItemsByRow(byBand.range ?? [], 8);
  /** @type {Array<{ range: string, name: string, description: string }>} */
  const results = [];
  for (const row of rangeRows) {
    const n = Number(normalizeText(joinBandText(row)));
    if (!Number.isFinite(n)) continue;
    const y = row[0].y;
    const text = joinBandText(
      (byBand.secret ?? []).filter((it) => it.y <= y + 5 && it.y >= y - 25),
    );
    if (!text) continue;
    const name = text.length > 50 ? text.slice(0, 47) + "..." : text;
    results.push({ range: String(n), name, description: text });
  }
  return results;
}

/**
 * @param {import('./pdfText.mjs').TextItem[]} region
 */
function parseFoeGenerator(region) {
  const bands = { range: [38, 55], text: [56, 520] };
  const byBand = itemsByBand(region, bands);
  const rangeRows = groupItemsByRow(byBand.range ?? [], 8);
  /** @type {Array<{ range: string, name: string, description: string }>} */
  const results = [];
  for (const row of rangeRows) {
    const range = parseRangeToken(joinBandText(row));
    if (!range) continue;
    const y = row[0].y;
    const text = joinBandText(
      (byBand.text ?? []).filter((it) => it.y <= y + 5 && it.y >= y - 45),
    );
    if (!text) continue;
    const { name } = nameBeforeColon(text);
    results.push({
      range,
      name: name || text.slice(0, 40),
      description: text,
    });
  }
  return results;
}

/**
 * @param {import('./pdfText.mjs').TextItem[]} allItems
 * @param {Record<string, unknown>} profile
 */
export function parseTableFromProfile(allItems, profile) {
  const region = sliceTableRegion(
    allItems,
    String(profile.startHeading),
    profile.endHeading ? String(profile.endHeading) : undefined,
    {
      startAfter: profile.startAfter ? String(profile.startAfter) : undefined,
      printedPage:
        profile.printedPage != null ? Number(profile.printedPage) : undefined,
      printedPageEnd:
        profile.printedPageEnd != null
          ? Number(profile.printedPageEnd)
          : undefined,
      exactStart: Boolean(profile.exactStart),
    },
  );

  const layout = String(profile.layout);
  /** @type {Array<{ range: string, name: string, description?: string }>} */
  let results = [];

  switch (layout) {
    case "singleColumn":
      results = parseSingleColumnNameEffect(region, profile);
      break;
    case "nameEqualsDescription":
      results = parseNameEqualsTwoColumn(region, profile);
      break;
    case "twoColumnD20":
      results = parseTwoColumnD20Encounter(region, profile);
      break;
    case "twoColumnTruth":
      results = parseTwoColumnTruth(region, profile);
      break;
    case "twoColumnState":
      results = parseTwoColumnState(region);
      break;
    case "twoColumnMods":
      results = parseTwoColumnMods(region, profile.modColumn === "weapon" ? "weapon" : "armor");
      break;
    case "bandedRows":
      results = parseBandedRows(region, profile);
      break;
    case "threeColumnSum":
      results = parseThreeColumnSum(region);
      break;
    case "goalSubTable":
      results = parseGoalSubTable(region);
      break;
    case "npcSecret":
      results = parseNpcSecret(region);
      break;
    case "foeGenerator":
      results = parseFoeGenerator(region);
      break;
    case "npcTruth":
      results = parseBandedRows(region, {
        xBands: { range: [38, 55], primary: [56, 145], secondary: [146, 520] },
      });
      break;
    case "demeanorColumn":
      results = parseDemeanorColumn(
        region,
        profile.demeanorColumn === "evens" ? "evens" : "odds",
      );
      break;
    default:
      throw new Error(`Unknown layout: ${layout}`);
  }

  const warnings = collectWarnings(results, profile);

  return { results, warnings, regionItemCount: region.length };
}

/**
 * @param {Record<string, unknown>} profile
 * @param {Array<{ range: string, name: string, description?: string }>} results
 */
export function buildManifest(profile, results) {
  /** @type {Record<string, unknown>} */
  const manifest = {
    title: profile.title,
    slug: profile.slug,
    layout: profile.layoutHint ?? profile.layout,
    source: {
      document: "Fallout-2d20-Wasteland-Wanderer.pdf",
      page: profile.printedPage ?? null,
    },
    results: results.map((r) => {
      /** @type {Record<string, string>} */
      const row = { range: r.range, name: r.name };
      if (profile.nameEqualsDescription) return row;
      if (r.description !== undefined && r.description !== r.name) {
        row.description = r.description;
      }
      return row;
    }),
  };

  if (profile.rollMin != null) manifest.rollMin = profile.rollMin;
  if (profile.rollMax != null) manifest.rollMax = profile.rollMax;
  if (profile.formula) manifest.formula = profile.formula;
  if (profile.nameEqualsDescription) manifest.nameEqualsDescription = true;
  if (profile.description) manifest.description = profile.description;

  return manifest;
}
