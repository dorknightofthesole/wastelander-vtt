import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** @typedef {{ text: string, x: number, y: number, page: number }} TextItem */

const APPENDIX_PDF_START = 160;
const APPENDIX_PDF_END = 230;

/**
 * @param {string} text
 */
export function normalizeText(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/['']/g, "'")
    .trim();
}

/**
 * @param {string} pdfPath
 */
export async function loadPdf(pdfPath) {
  const data = new Uint8Array(readFileSync(pdfPath));
  return getDocument({ data, useSystemFonts: true }).promise;
}

/**
 * @param {import('pdfjs-dist').PDFDocumentProxy} doc
 * @param {number} pageNum 1-based
 * @returns {Promise<TextItem[]>}
 */
export async function extractPageItems(doc, pageNum) {
  const page = await doc.getPage(pageNum);
  const content = await page.getTextContent();
  /** @type {TextItem[]} */
  const items = [];
  for (const item of content.items) {
    if (!("str" in item) || !item.str.trim()) continue;
    const [, , , , x, y] = item.transform;
    items.push({
      text: item.str,
      x: Math.round(x),
      y: Math.round(y),
      page: pageNum,
    });
  }
  return items;
}

/**
 * @param {import('pdfjs-dist').PDFDocumentProxy} doc
 * @param {{ start?: number, end?: number }} [range]
 * @returns {Promise<TextItem[]>}
 */
export async function extractAppendixItems(doc, range = {}) {
  const start = range.start ?? APPENDIX_PDF_START;
  const end = Math.min(range.end ?? APPENDIX_PDF_END, doc.numPages);
  /** @type {TextItem[]} */
  const all = [];
  for (let page = start; page <= end; page++) {
    const items = await extractPageItems(doc, page);
    all.push(...items);
  }
  return all;
}

/**
 * @param {TextItem[]} items
 * @param {string} heading
 */
export function findHeadingIndex(items, heading) {
  const target = normalizeText(heading).toLowerCase();
  for (let i = 0; i < items.length; i++) {
    const chunk = normalizeText(
      items
        .slice(i, i + 12)
        .map((it) => it.text)
        .join(" "),
    ).toLowerCase();
    if (chunk.includes(target)) return i;
  }
  return -1;
}

/**
 * @param {TextItem[]} items
 * @param {string} heading
 * @param {number} [fromIndex]
 */
export function findHeadingIndexFrom(items, heading, fromIndex = 0) {
  const slice = items.slice(fromIndex);
  const idx = findHeadingIndex(slice, heading);
  return idx < 0 ? -1 : fromIndex + idx;
}

/**
 * @param {TextItem[]} items
 * @param {string} heading
 * @param {number} [fromIndex]
 */
export function findExactHeadingIndex(items, heading, fromIndex = 0) {
  const target = normalizeText(heading).toLowerCase();
  for (let i = fromIndex; i < items.length; i++) {
    if (normalizeText(items[i].text).toLowerCase() === target) return i;
  }
  return -1;
}

/**
 * Printed book page → 1-based PDF page index (Wasteland Wanderer appendix).
 * @param {number} printedPage
 */
export function printedToPdfPage(printedPage) {
  return printedPage + 4;
}

/**
 * @param {TextItem[]} items
 * @param {string} startHeading
 * @param {string} [endHeading]
 * @param {{ startAfter?: string, printedPage?: number, printedPageEnd?: number, exactStart?: boolean }} [options]
 */
export function sliceTableRegion(items, startHeading, endHeading, options = {}) {
  let pool = items;
  if (options.printedPage != null) {
    const pdfStart = printedToPdfPage(options.printedPage);
    const pdfEnd = printedToPdfPage(
      options.printedPageEnd ?? options.printedPage,
    );
    pool = items.filter((it) => it.page >= pdfStart && it.page <= pdfEnd);
  }

  let searchFrom = 0;
  if (options.startAfter) {
    const afterIdx = findHeadingIndex(pool, options.startAfter);
    if (afterIdx < 0) {
      throw new Error(`startAfter heading not found: "${options.startAfter}"`);
    }
    searchFrom = afterIdx;
  }
  const start = options.exactStart
    ? findExactHeadingIndex(pool, startHeading, searchFrom)
    : findHeadingIndexFrom(pool, startHeading, searchFrom);
  if (start < 0) {
    throw new Error(`Start heading not found: "${startHeading}"`);
  }
  let end = pool.length;
  if (endHeading) {
    const endIdx = findHeadingIndex(pool.slice(start + 1), endHeading);
    if (endIdx >= 0) end = start + 1 + endIdx;
  }
  return pool.slice(start, end);
}

/**
 * @param {TextItem[]} items
 * @param {number} [tolerance]
 */
export function groupItemsByRow(items, tolerance = 6) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  /** @type {TextItem[][]} */
  const rows = [];
  for (const item of sorted) {
    const row = rows.find((r) => Math.abs(r[0].y - item.y) <= tolerance);
    if (row) row.push(item);
    else rows.push([item]);
  }
  for (const row of rows) row.sort((a, b) => a.x - b.x);
  return rows.sort((a, b) => b[0].y - a[0].y);
}

/**
 * @param {TextItem} item
 * @param {Record<string, [number, number]>} bands
 */
export function bandForItem(item, bands) {
  for (const [name, [low, high]] of Object.entries(bands)) {
    if (item.x >= low && item.x <= high) return name;
  }
  return null;
}

/**
 * @param {TextItem[]} items
 * @param {Record<string, [number, number]>} bands
 */
export function itemsByBand(items, bands) {
  /** @type {Record<string, TextItem[]>} */
  const out = {};
  for (const [name] of Object.entries(bands)) out[name] = [];
  for (const item of items) {
    const band = bandForItem(item, bands);
    if (band) out[band].push(item);
  }
  return out;
}

/**
 * @param {TextItem[]} items
 */
export function joinBandText(items) {
  return normalizeText(
    [...items]
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map((it) => it.text)
      .join(" "),
  );
}

/**
 * @param {TextItem[]} items
 * @param {number} pageNum
 */
export function dumpPageItems(items, pageNum) {
  const pageItems = items.filter((it) => it.page === pageNum);
  const lines = groupItemsByRow(pageItems, 4);
  for (const row of lines) {
    const parts = row.map((it) => `${it.x},${it.y}:${JSON.stringify(it.text)}`);
    console.log(parts.join("  "));
  }
}

/**
 * Parse "162-163" or "162" into PDF page numbers (1-based).
 * @param {string} spec
 */
export function parsePageSpec(spec) {
  const [a, b] = spec.split("-").map((n) => Number(n.trim()));
  if (!Number.isFinite(a)) throw new Error(`Invalid page spec: ${spec}`);
  if (!Number.isFinite(b)) return [a];
  const pages = [];
  for (let p = a; p <= b; p++) pages.push(p);
  return pages;
}
