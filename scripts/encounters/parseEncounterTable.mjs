import {
  groupItemsByRow,
  itemsByBand,
  joinBandText,
  normalizeText,
} from "../oracle/pdfText.mjs";

const ROLL_RE = /^\d+(-\d+)?$/;
const BAND_RANGE_RE = /^(\d+)\s*-\s*(\d+)$/;
const PLUS_RANGE_RE = /^(\d+)\+$/;

/**
 * @param {string} text
 */
function parseRangeToken(text) {
  const t = normalizeText(text).replace(/\u2013/g, "-");
  const plus = PLUS_RANGE_RE.exec(t);
  if (plus) return `${plus[1]}+`;
  const band = BAND_RANGE_RE.exec(t);
  if (band) return `${band[1]}-${band[2]}`;
  const single = /^(\d+)$/.exec(t);
  if (single) return single[1];
  return null;
}

/**
 * @param {import('../oracle/pdfText.mjs').TextItem} item
 */
function isTitleFont(item) {
  const font = String(item.fontName ?? "");
  return /f[48]$/.test(font) || /bold/i.test(font);
}

/**
 * @param {import('../oracle/pdfText.mjs').TextItem[]} items
 * @param {{ pdfPage?: number, pdfPageEnd?: number, yMin?: number, yMax?: number }} profile
 */
export function filterPdfRegion(items, profile) {
  const start = Number(profile.pdfPage ?? profile.printedPage ?? 0);
  const end = Number(profile.pdfPageEnd ?? profile.pdfPage ?? start);
  const yMin = Number(profile.yMin ?? 0);
  const yMax = Number(profile.yMax ?? 9999);
  return items.filter(
    (it) =>
      it.page >= start &&
      it.page <= end &&
      it.y >= yMin &&
      it.y <= yMax &&
      !/^(FALLOUT|GM Toolkit|GAMEMASTER OPTIONS|The Roleplaying Game)$/i.test(
        it.text.trim(),
      ),
  );
}

/**
 * Random Encounter Type — right column d20 ranges + labels (GM Toolkit p.20).
 * @param {import('../oracle/pdfText.mjs').TextItem[]} region
 */
export function parseGmToolkitEncounterType(region) {
  const bands = {
    range: [330, 365],
    label: [430, 470],
  };
  const byBand = itemsByBand(region, bands);
  const rangeRows = groupItemsByRow(byBand.range ?? [], 8);
  /** @type {Array<{ range: string, name: string }>} */
  const results = [];
  for (const row of rangeRows) {
    const range = parseRangeToken(joinBandText(row));
    if (!range) continue;
    const y = row[0].y;
    const label = joinBandText(
      (byBand.label ?? []).filter((it) => Math.abs(it.y - y) <= 10),
    );
    if (!label) continue;
    results.push({ range, name: label });
  }
  return results.sort(
    (a, b) =>
      Number(String(a.range).split("-")[0]) -
      Number(String(b.range).split("-")[0]),
  );
}

/**
 * GM Toolkit encounter tables — bold title + body; roll in left column (pp.21–24).
 * @param {import('../oracle/pdfText.mjs').TextItem[]} region
 * @param {Record<string, unknown>} profile
 */
export function parseGmToolkitTitleBody(region, profile) {
  const rollBand = /** @type {[number, number]} */ (
    profile.rollBand ?? [68, 112]
  );
  const contentMinX = Number(profile.contentMinX ?? 108);

  const titleAnchors = region
    .filter((it) => {
      const text = normalizeText(it.text);
      if (it.x < contentMinX || it.x > 220) return false;
      return (
        (isTitleFont(it) && /:$/.test(text)) ||
        /^[A-Z0-9][A-Z0-9\s'/-]+:$/.test(text)
      );
    })
    .sort((a, b) => b.y - a.y);

  /** @type {Array<{ range: string, name: string, description: string }>} */
  const results = [];

  for (let i = 0; i < titleAnchors.length; i++) {
    const titleItem = titleAnchors[i];
    const name = normalizeText(titleItem.text).replace(/:+$/, "").trim();
    const yTop = titleItem.y + 8;
    const yBottom =
      i < titleAnchors.length - 1 ? titleAnchors[i + 1].y - 2 : 0;

    const block = region.filter(
      (it) =>
        it.y <= yTop &&
        it.y >= yBottom &&
        it.x >= contentMinX &&
        it.x < 520 &&
        it !== titleItem,
    );

    const rollCandidates = region.filter(
      (it) =>
        it.x >= rollBand[0] &&
        it.x <= rollBand[1] &&
        it.y <= yTop &&
        it.y >= yBottom &&
        ROLL_RE.test(normalizeText(it.text).replace(/\u2013/g, "-")),
    );
    const rollItem = rollCandidates.sort((a, b) => a.y - b.y)[0];
    const range =
      rollItem != null
        ? (parseRangeToken(rollItem.text) ?? normalizeText(rollItem.text))
        : String(results.length + 1);

    const bodyItems = block.filter((it) => !isTitleFont(it) || !/:$/.test(it.text));
    let description = joinBandText(bodyItems);
    if (description.startsWith(name)) {
      description = normalizeText(description.slice(name.length).replace(/^:\s*/, ""));
    }

    results.push({
      range,
      name,
      description: description && description !== name ? description : "",
    });
  }

  return results;
}

/**
 * @param {import('../oracle/pdfText.mjs').TextItem[]} allItems
 * @param {Record<string, unknown>} profile
 */
export function parseEncounterTableFromProfile(allItems, profile) {
  const region = filterPdfRegion(allItems, profile);
  const layout = String(profile.layout);

  /** @type {Array<{ range: string, name: string, description?: string }>} */
  let results = [];
  switch (layout) {
    case "gmToolkitEncounterType":
      results = parseGmToolkitEncounterType(region);
      break;
    case "gmToolkitTitleBody":
      results = parseGmToolkitTitleBody(region, profile);
      break;
    default:
      throw new Error(`Unknown encounter layout: ${layout}`);
  }

  return { results, warnings: [], regionItemCount: region.length };
}

/**
 * @param {Record<string, unknown>} profile
 * @param {Array<{ range: string, name: string, description?: string }>} results
 */
export function buildEncounterManifest(profile, results) {
  /** @type {Record<string, unknown>} */
  const manifest = {
    title: profile.title,
    slug: profile.slug,
    layout: profile.layout,
    source: {
      document: "Fallout-2d20-GM-Toolkit.pdf",
      page: profile.pdfPage ?? null,
    },
    results: results.map((r) => {
      /** @type {Record<string, string>} */
      const row = { range: r.range, name: r.name };
      if (profile.nameEqualsDescription) return row;
      if (r.description && r.description !== r.name) {
        row.description = r.description;
      }
      return row;
    }),
  };

  if (profile.rollMin != null) manifest.rollMin = profile.rollMin;
  if (results.length > 0) {
    manifest.rollMax = profile.rollMax != null ? profile.rollMax : results.length;
    if (profile.rollMin == null) manifest.rollMin = 1;
  } else if (profile.rollMax != null) {
    manifest.rollMax = profile.rollMax;
  }
  if (profile.formula) manifest.formula = profile.formula;
  if (profile.nameEqualsDescription) manifest.nameEqualsDescription = true;
  if (profile.description) manifest.description = profile.description;

  return manifest;
}
