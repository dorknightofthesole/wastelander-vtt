import { randomBytes } from "node:crypto";
import { deriveFormula, parseRange } from "./parseRange.mjs";

const RESULT_IMG = "icons/svg/d20-black.svg";

function randomId(length = 16) {
  const alphabet =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(length);
  let id = "";
  for (let i = 0; i < length; i++) {
    id += alphabet[bytes[i] % alphabet.length];
  }
  return id;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toDescriptionHtml(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return "";
  const paragraphs = trimmed.split(/\n\s*\n/).filter(Boolean);
  return paragraphs
    .map((p) => `<p>${escapeHtml(p.trim())}</p>`)
    .join("");
}

function defaultStats(now) {
  return {
    compendiumSource: null,
    duplicateSource: null,
    exportSource: null,
    coreVersion: "13.351",
    systemId: "fallout",
    systemVersion: "11.16.6",
    createdTime: now,
    modifiedTime: now,
    lastModifiedBy: null,
  };
}

/**
 * @param {Array<Record<string, unknown>> | undefined} existingResults
 * @param {[number, number]} range
 * @param {string} name
 */
function findExistingResult(existingResults, range, name) {
  if (!Array.isArray(existingResults)) return undefined;
  const [low, high] = range;
  const byRangeAndName = existingResults.find(
    (row) =>
      row.range?.[0] === low &&
      row.range?.[1] === high &&
      String(row.name ?? "").trim() === name,
  );
  if (byRangeAndName) return byRangeAndName;
  return existingResults.find(
    (row) => row.range?.[0] === low && row.range?.[1] === high,
  );
}

/**
 * @param {Record<string, unknown> | undefined} prevStats
 * @param {number} now
 */
function buildStats(prevStats, now) {
  if (prevStats && typeof prevStats === "object") {
    return { ...prevStats, modifiedTime: now };
  }
  return defaultStats(now);
}

/**
 * @param {Record<string, unknown>} baseDoc - template or an existing output file
 * @param {{
 *   title: string;
 *   description?: string;
 *   formula?: string;
 *   rollMin?: number;
 *   rollMax?: number;
 *   nameEqualsDescription?: boolean;
 *   results: Array<{ range: string | [number, number]; name: string; description?: string }>;
 * }} manifest
 */
export function emitFoundryRollTable(baseDoc, manifest) {
  const now = Date.now();
  const rollMax = manifest.rollMax ?? 100;
  const existingResults = Array.isArray(baseDoc.results) ? baseDoc.results : [];

  const results = manifest.results.map((row) => {
    const range = parseRange(row.range, { rollMax });
    const name = String(row.name ?? "").trim();
    let descriptionText = row.description;
    if (manifest.nameEqualsDescription || descriptionText === undefined) {
      descriptionText = name;
    }
    descriptionText = String(descriptionText ?? "").trim();
    const description =
      descriptionText === name ? "" : toDescriptionHtml(descriptionText);
    const prev = findExistingResult(existingResults, range, name);
    return {
      type: prev?.type ?? "text",
      weight: prev?.weight ?? 1,
      range,
      _id: typeof prev?._id === "string" ? prev._id : randomId(16),
      name,
      img: typeof prev?.img === "string" ? prev.img : RESULT_IMG,
      description,
      drawn: prev?.drawn ?? false,
      flags:
        prev?.flags && typeof prev.flags === "object" ? { ...prev.flags } : {},
      _stats: buildStats(prev?._stats, now),
      documentUuid: prev?.documentUuid ?? null,
    };
  });

  const formula =
    manifest.formula ??
    deriveFormula(manifest.results, {
      rollMin: manifest.rollMin,
      rollMax: manifest.rollMax,
    });

  const doc = structuredClone(baseDoc);
  doc.name = manifest.title;
  doc.description = manifest.description ?? doc.description ?? "";
  doc.formula = formula;
  doc.results = results;
  doc.replacement = doc.replacement ?? true;
  doc.displayRoll = doc.displayRoll ?? true;
  if (!doc.ownership) doc.ownership = { default: 0 };
  doc._stats = buildStats(doc._stats, now);

  return doc;
}
