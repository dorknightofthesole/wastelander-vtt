#!/usr/bin/env node
/**
 * Build Foundry RollTable JSON from oracle manifests.
 *
 * Usage:
 *   npm run build:oracle                    # all manifests
 *   npm run build:oracle -- --list          # list available tables
 *   npm run build:oracle -- clear-blocker-table
 *   npm run build:oracle -- --table clear-blocker-table
 *   npm run build:oracle -- -t "Clear Blocker Table"
 *   node scripts/build-oracle-rolltables.mjs --all
 *   node scripts/build-oracle-rolltables.mjs [pdf-path] --table slug
 */
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitFoundryRollTable } from "./oracle/emitFoundryRollTable.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const MANIFEST_DIR = join(ROOT, "scripts/oracle/manifests");
const GROUPS_PATH = join(ROOT, "scripts/oracle/groups.json");
const TEMPLATE_PATH = join(
  ROOT,
  "src/data/oracle/foundryvtt-rolltable.json.example",
);
const OUT_DIR = join(ROOT, "src/data/oracle");
const DEFAULT_PDF = join(
  ROOT,
  "docs/reference/source/Fallout-2d20-Wasteland-Wanderer.pdf",
);

function slugifyTableName(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeTableKey(input) {
  return slugifyTableName(input.replace(/\.json$/i, ""));
}

function tableKeysFromEnv() {
  const keys = [];
  const single = process.env.ORACLE_TABLE?.trim();
  const many = process.env.ORACLE_TABLES?.trim();
  if (single) keys.push(normalizeTableKey(single));
  if (many) {
    for (const part of many.split(",")) {
      const key = normalizeTableKey(part);
      if (key) keys.push(key);
    }
  }
  return keys;
}

function printHelp() {
  console.log(`Build Foundry RollTable JSON from oracle manifests.

npm requires "run" and "--" before script flags:
  npm run build:oracle -- --table "Clear Blocker Table"
  NOT: npm build:oracle --table "..."  (invalid)

Usage:
  npm run build:oracle                         Build all tables
  npm run build:oracle -- <table>              Build one table (slug or title)
  npm run build:oracle -- --table <table>      Build one table
  npm run build:oracle -- -t a -t b            Build multiple tables
  npm run build:oracle:list                    List available tables

Without npm "--" (env shortcut):
  ORACLE_TABLE="clear-blocker-table" npm run build:oracle
  ORACLE_TABLES="a,b" npm run build:oracle

Direct node (no npm):
  node scripts/build-oracle-rolltables.mjs --table clear-blocker-table
  node scripts/build-oracle-rolltables.mjs --list

Table names match manifest slug (e.g. clear-blocker-table) or manifest title
(e.g. "Clear Blocker Table"). Appendix section headers (e.g. "Location Generation
Tables") build every table in that section via scripts/oracle/groups.json.
`);
}

/**
 * @returns {{ pdfPath: string, tableKeys: string[], list: boolean, all: boolean, help: boolean }}
 */
function parseArgs(argv) {
  const tableKeys = [];
  let pdfPath = DEFAULT_PDF;
  let list = false;
  let all = false;
  let help = false;

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
    if (arg === "--all" || arg === "-a") {
      all = true;
      continue;
    }
    if (arg === "--table" || arg === "-t") {
      const next = argv[++i];
      if (!next) throw new Error("Missing value after --table");
      tableKeys.push(normalizeTableKey(next));
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg} (try --help)`);
    }

    if (!existsSync(arg) && !arg.toLowerCase().endsWith(".pdf")) {
      tableKeys.push(normalizeTableKey(arg));
      continue;
    }

    pdfPath = arg;
  }

  const envKeys = tableKeysFromEnv();
  for (const key of envKeys) {
    if (!tableKeys.includes(key)) tableKeys.push(key);
  }

  return { pdfPath, tableKeys, list, all, help };
}

async function readTableGroups() {
  try {
    const raw = await readFile(GROUPS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const groups = new Map();
    for (const [groupKey, slugs] of Object.entries(parsed)) {
      const key = normalizeTableKey(groupKey);
      groups.set(
        key,
        slugs.map((slug) => normalizeTableKey(String(slug))),
      );
    }
    return groups;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return new Map();
    }
    throw err;
  }
}

async function readAllManifestEntries() {
  const files = (await readdir(MANIFEST_DIR)).filter((f) => f.endsWith(".json"));
  const entries = [];
  for (const file of files.sort()) {
    const raw = await readFile(join(MANIFEST_DIR, file), "utf8");
    const manifest = JSON.parse(raw);
    const slug = manifest.slug ?? basename(file, ".json");
    entries.push({
      file,
      slug,
      title: manifest.title ?? slug,
      manifest,
    });
  }
  return entries;
}

function resolveManifests(entries, tableKeys, groups) {
  if (tableKeys.length === 0) {
    return entries.map((e) => ({ ...e.manifest, slug: e.slug }));
  }

  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  const byTitle = new Map(
    entries.map((e) => [normalizeTableKey(e.title), e]),
  );

  const selected = [];
  const seen = new Set();
  const missing = [];

  function addEntry(entry) {
    if (seen.has(entry.slug)) return;
    seen.add(entry.slug);
    selected.push({ ...entry.manifest, slug: entry.slug });
  }

  for (const key of tableKeys) {
    const groupSlugs = groups.get(key);
    if (groupSlugs) {
      for (const slug of groupSlugs) {
        const entry = bySlug.get(slug);
        if (!entry) {
          console.warn(
            `Skipping ${slug} — no manifest yet (group: ${key})`,
          );
          continue;
        }
        addEntry(entry);
      }
      continue;
    }

    const entry = bySlug.get(key) ?? byTitle.get(key);
    if (!entry) {
      missing.push(key);
      continue;
    }
    addEntry(entry);
  }

  if (missing.length > 0) {
    const availableTables = entries
      .map((e) => `  - ${e.slug}  (${e.title})`)
      .join("\n");
    const availableGroups = [...groups.keys()]
      .map((g) => `  - ${g}  (${groups.get(g).length} tables)`)
      .join("\n");
    const groupSection = availableGroups
      ? `\n\nSection groups:\n${availableGroups}`
      : "";
    throw new Error(
      `No manifest matched: ${missing.join(", ")}\n\nAvailable tables:\n${availableTables}${groupSection}`,
    );
  }

  return selected;
}

async function main() {
  const { pdfPath, tableKeys, list, all, help } = parseArgs(process.argv);

  if (help) {
    printHelp();
    return;
  }

  const [entries, groups] = await Promise.all([
    readAllManifestEntries(),
    readTableGroups(),
  ]);

  if (list) {
    if (!entries.length) {
      console.log(`No manifests in ${MANIFEST_DIR}`);
      return;
    }
    console.log("Oracle roll table manifests:\n");
    for (const e of entries) {
      console.log(`  ${e.slug}`);
      console.log(`    title: ${e.title}`);
      console.log(`    file:  scripts/oracle/manifests/${e.file}\n`);
    }
    if (groups.size > 0) {
      console.log("Section groups (build all tables in a section):\n");
      for (const [groupKey, slugs] of groups) {
        console.log(`  ${groupKey}`);
        console.log(`    tables: ${slugs.join(", ")}\n`);
      }
    }
    return;
  }

  const buildAll = tableKeys.length === 0;
  const manifests = buildAll
    ? entries.map((e) => ({ ...e.manifest, slug: e.slug }))
    : resolveManifests(entries, tableKeys, groups);

  if (!manifests.length) {
    console.log("No manifests to build. Use --list to see available tables.");
    return;
  }

  if (!existsSync(pdfPath)) {
    console.warn(
      `PDF not found at ${pdfPath} — building from manifests only.`,
    );
    console.warn(
      "Place Fallout-2d20-Wasteland-Wanderer.pdf in docs/reference/source/ for future PDF validation.",
    );
  } else {
    console.log(`PDF: ${pdfPath}`);
  }

  const scope =
    buildAll && tableKeys.length === 0
      ? `all ${manifests.length} manifest(s) in scripts/oracle/manifests/`
      : `${manifests.length} table(s): ${manifests.map((m) => m.slug).join(", ")}`;
  console.log(`Building ${scope}`);

  const template = JSON.parse(await readFile(TEMPLATE_PATH, "utf8"));

  for (const manifest of manifests) {
    const outPath = join(OUT_DIR, `${manifest.slug}.json`);
    let baseDoc = template;
    const existed = existsSync(outPath);
    if (existed) {
      baseDoc = JSON.parse(await readFile(outPath, "utf8"));
    }
    const doc = emitFoundryRollTable(baseDoc, manifest);
    await writeFile(outPath, `${JSON.stringify(doc, null, 2)}\n`, {
      encoding: "utf8",
      flag: "w",
    });
    const verb = existed ? "Overwrote" : "Wrote";
    console.log(
      `${verb} ${outPath} (${doc.results.length} results, formula ${doc.formula})`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
