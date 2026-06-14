#!/usr/bin/env node
/**
 * Build Foundry RollTable JSON from GM Toolkit encounter manifests.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitFoundryRollTable } from "./oracle/emitFoundryRollTable.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const MANIFEST_DIR = join(ROOT, "scripts/encounters/manifests");
const GROUPS_PATH = join(ROOT, "scripts/encounters/groups.json");
const TEMPLATE_PATH = join(
  ROOT,
  "src/data/encounters/foundryvtt-rolltable.json.example",
);
const OUT_DIR = join(ROOT, "src/data/encounters");

function slugify(input) {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseArgs(argv) {
  const tableKeys = [];
  let list = false;
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
    if (arg === "--table" || arg === "-t") {
      tableKeys.push(slugify(argv[++i] ?? ""));
      continue;
    }
    if (!arg.startsWith("-")) {
      tableKeys.push(slugify(arg));
    }
  }
  return { tableKeys, list, help };
}

async function readGroups() {
  const raw = await readFile(GROUPS_PATH, "utf8");
  const parsed = JSON.parse(raw);
  const groups = new Map();
  for (const [key, slugs] of Object.entries(parsed)) {
    groups.set(slugify(key), slugs.map((s) => slugify(String(s))));
  }
  return groups;
}

async function readManifests() {
  const files = (await readdir(MANIFEST_DIR)).filter((f) => f.endsWith(".json"));
  const entries = [];
  for (const file of files.sort()) {
    const manifest = JSON.parse(await readFile(join(MANIFEST_DIR, file), "utf8"));
    const slug = manifest.slug ?? basename(file, ".json");
    entries.push({ slug, manifest });
  }
  return entries;
}

function resolveManifests(entries, tableKeys, groups) {
  if (!tableKeys.length) return entries.map((e) => ({ ...e.manifest, slug: e.slug }));
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  const selected = [];
  const seen = new Set();
  for (const key of tableKeys) {
    const group = groups.get(key);
    if (group) {
      for (const slug of group) {
        const entry = bySlug.get(slug);
        if (entry && !seen.has(slug)) {
          seen.add(slug);
          selected.push({ ...entry.manifest, slug });
        }
      }
      continue;
    }
    const entry = bySlug.get(key);
    if (entry && !seen.has(key)) {
      seen.add(key);
      selected.push({ ...entry.manifest, slug: entry.slug });
    }
  }
  return selected;
}

async function main() {
  const { tableKeys, list, help } = parseArgs(process.argv);
  if (help) {
    console.log("npm run build:encounters [-- --table slug]");
    return;
  }

  const [entries, groups] = await Promise.all([readManifests(), readGroups()]);
  if (list) {
    for (const e of entries) console.log(`${e.slug} (${e.manifest.title})`);
    return;
  }

  const manifests = resolveManifests(entries, tableKeys, groups);
  if (!manifests.length) {
    console.log("No manifests. Run npm run extract:encounters first.");
    return;
  }

  const template = JSON.parse(await readFile(TEMPLATE_PATH, "utf8"));
  for (const manifest of manifests) {
    const outPath = join(OUT_DIR, `${manifest.slug}.json`);
    let baseDoc = template;
    const existed = existsSync(outPath);
    if (existed) {
      baseDoc = JSON.parse(await readFile(outPath, "utf8"));
    }
    const doc = emitFoundryRollTable(baseDoc, manifest);
    await writeFile(outPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    console.log(
      `${existed ? "Overwrote" : "Wrote"} ${outPath} (${doc.results.length} results)`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
