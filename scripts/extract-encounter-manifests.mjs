#!/usr/bin/env node
/**
 * Extract GM Toolkit random encounter manifests from the local PDF.
 *
 * Usage:
 *   npm run extract:encounters
 *   npm run extract:encounters -- --table random-ordinary-encounters
 *   npm run extract:encounters -- --dump-pages 21
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { profiles } from "./encounters/layouts/profiles.mjs";
import {
  buildEncounterManifest,
  parseEncounterTableFromProfile,
} from "./encounters/parseEncounterTable.mjs";
import {
  dumpPageItems,
  extractPageItems,
  loadPdf,
  parsePageSpec,
} from "./oracle/pdfText.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const MANIFEST_DIR = join(ROOT, "scripts/encounters/manifests");
const STAGING_DIR = join(ROOT, "scripts/encounters/manifests-staging");
const GROUPS_PATH = join(ROOT, "scripts/encounters/groups.json");
const DEFAULT_PDF = join(
  ROOT,
  "docs/reference/source/Fallout-2d20-GM-Toolkit.pdf",
);

function slugify(input) {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function printHelp() {
  console.log(`Extract GM Toolkit encounter manifests from the local PDF.

Usage:
  npm run extract:encounters
  npm run extract:encounters -- --table <slug>
  npm run extract:encounters -- --list
  npm run extract:encounters -- --dump-pages 21

Requires PDF at docs/reference/source/Fallout-2d20-GM-Toolkit.pdf
Then run: npm run build:encounters
`);
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {string[]} */
  const tableKeys = [];
  let pdfPath = DEFAULT_PDF;
  let list = false;
  let help = false;
  let dumpPages = null;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--list" || arg === "-l") {
      list = true;
      continue;
    }
    if (arg === "--dump-pages") {
      dumpPages = argv[++i];
      continue;
    }
    if (arg === "--table" || arg === "-t") {
      tableKeys.push(slugify(argv[++i] ?? ""));
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (!existsSync(arg) && !arg.toLowerCase().endsWith(".pdf")) {
      tableKeys.push(slugify(arg));
      continue;
    }
    pdfPath = arg;
  }

  return { pdfPath, tableKeys, list, help, dumpPages };
}

async function readGroups() {
  try {
    const raw = await readFile(GROUPS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const groups = new Map();
    for (const [key, slugs] of Object.entries(parsed)) {
      groups.set(slugify(key), slugs.map((s) => slugify(String(s))));
    }
    return groups;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return new Map();
    }
    throw err;
  }
}

function resolveProfiles(tableKeys, groups) {
  if (tableKeys.length === 0) return profiles;
  const bySlug = new Map(profiles.map((p) => [p.slug, p]));
  const selected = [];
  const seen = new Set();
  for (const key of tableKeys) {
    const group = groups.get(key);
    if (group) {
      for (const slug of group) {
        const profile = bySlug.get(slug);
        if (profile && !seen.has(slug)) {
          seen.add(slug);
          selected.push(profile);
        }
      }
      continue;
    }
    const profile = bySlug.get(key);
    if (profile && !seen.has(key)) {
      seen.add(key);
      selected.push(profile);
    }
  }
  if (!selected.length) {
    throw new Error(
      `No profile matched: ${tableKeys.join(", ")}. Use --list to see slugs.`,
    );
  }
  return selected;
}

async function main() {
  const { pdfPath, tableKeys, list, help, dumpPages } = parseArgs(process.argv);
  if (help) {
    printHelp();
    return;
  }

  if (list) {
    console.log("GM Toolkit encounter profiles:\n");
    for (const p of profiles) {
      console.log(`  ${p.slug}`);
      console.log(`    title: ${p.title}`);
      console.log(`    pages: ${p.pdfPage}${p.pdfPageEnd !== p.pdfPage ? `-${p.pdfPageEnd}` : ""}\n`);
    }
    const groups = await readGroups();
    if (groups.size) {
      console.log("Groups:\n");
      for (const [key, slugs] of groups) {
        console.log(`  ${key}: ${slugs.join(", ")}`);
      }
    }
    return;
  }

  if (!existsSync(pdfPath)) {
    console.error(`PDF not found at ${pdfPath}`);
    process.exit(1);
  }

  const doc = await loadPdf(pdfPath);
  console.log(`PDF: ${pdfPath} (${doc.numPages} pages)`);

  if (dumpPages) {
    const pages = parsePageSpec(dumpPages);
    for (const pageNum of pages) {
      const items = await extractPageItems(doc, pageNum);
      console.log(`\n--- page ${pageNum} ---`);
      dumpPageItems(items, pageNum);
    }
    return;
  }

  await mkdir(MANIFEST_DIR, { recursive: true });
  await mkdir(STAGING_DIR, { recursive: true });

  const groups = await readGroups();
  const selected = resolveProfiles(tableKeys, groups);

  /** @type {Array<{ slug: string, status: string, count: number }>} */
  const summary = [];

  for (const profile of selected) {
    const start = Number(profile.pdfPage);
    const end = Number(profile.pdfPageEnd ?? profile.pdfPage);
    /** @type {import('./oracle/pdfText.mjs').TextItem[]} */
    const pageItems = [];
    for (let page = start; page <= end; page++) {
      pageItems.push(...(await extractPageItems(doc, page)));
    }

    const { results, warnings } = parseEncounterTableFromProfile(
      pageItems,
      profile,
    );
    const manifest = buildEncounterManifest(profile, results);
    const outPath = join(MANIFEST_DIR, `${profile.slug}.json`);
    const json = `${JSON.stringify(manifest, null, 2)}\n`;

    if (warnings.length) {
      console.warn(`${profile.slug} warnings:`, warnings);
    }

    if (existsSync(outPath)) {
      const existing = await readFile(outPath, "utf8");
      if (existing === json) {
        console.log(`Skip ${profile.slug} (${results.length} results, unchanged)`);
        summary.push({ slug: profile.slug, status: "skip", count: results.length });
        continue;
      }
      const stagingPath = join(STAGING_DIR, `${profile.slug}.json`);
      await writeFile(stagingPath, json, "utf8");
      console.log(
        `Staging ${profile.slug} (${results.length} results) → manifests-staging/`,
      );
      summary.push({ slug: profile.slug, status: "staging", count: results.length });
      continue;
    }

    await writeFile(outPath, json, "utf8");
    console.log(`Wrote ${profile.slug} (${results.length} results)`);
    summary.push({ slug: profile.slug, status: "wrote", count: results.length });
  }

  const changed = summary.filter((s) => s.status !== "skip");
  if (!changed.length) {
    console.log("Done — no manifest changes.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
