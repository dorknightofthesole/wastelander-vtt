#!/usr/bin/env node
/**
 * Extract draft oracle manifests from the licensed Wasteland Wanderer PDF.
 *
 * Usage:
 *   npm run extract:oracle
 *   npm run extract:oracle -- --table clear-blocker-table
 *   npm run extract:oracle -- --dump-pages 162
 *   npm run extract:oracle -- --diff clear-blocker-table
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { profiles } from "./oracle/layouts/profiles.mjs";
import { buildManifest, parseTableFromProfile } from "./oracle/parseTable.mjs";
import {
  dumpPageItems,
  extractAppendixItems,
  extractPageItems,
  loadPdf,
  parsePageSpec,
} from "./oracle/pdfText.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const MANIFEST_DIR = join(ROOT, "scripts/oracle/manifests");
const STAGING_DIR = join(ROOT, "scripts/oracle/manifests-staging");
const GROUPS_PATH = join(ROOT, "scripts/oracle/groups.json");
const STAGING_DIFF_PATH = join(STAGING_DIR, "staging-diff.md");
const DEFAULT_PDF = join(
  ROOT,
  "docs/reference/source/Fallout-2d20-Wasteland-Wanderer.pdf",
);

function slugify(input) {
  return String(input)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function printHelp() {
  console.log(`Extract draft oracle manifests from the local Wasteland Wanderer PDF.

Usage:
  npm run extract:oracle                         Extract all tables
  npm run extract:oracle -- generate-npc         Extract a section group (see groups.json)
  npm run extract:oracle -- --table <slug>       Extract one table or group
  npm run extract:oracle -- --list               List extraction profiles and groups
  npm run extract:oracle -- --dump-pages 162     Debug positioned text
  npm run extract:oracle -- --dump-pages 162-165
  npm run extract:oracle -- --diff <slug>        Compare draft to existing manifest (no writes)

Behavior:
  - No manifest yet → write scripts/oracle/manifests/<slug>.json
  - Manifest exists, same results → skip
  - Manifest exists, different results → write scripts/oracle/manifests-staging/<slug>.json
  - All differences → scripts/oracle/manifests-staging/staging-diff.md

Requires PDF at docs/reference/source/Fallout-2d20-Wasteland-Wanderer.pdf
Then run: npm run build:oracle
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
  let diffSlug = null;

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
      const next = argv[++i];
      if (!next) throw new Error("Missing value after --table");
      tableKeys.push(slugify(next));
      continue;
    }
    if (arg === "--dump-pages") {
      dumpPages = argv[++i];
      if (!dumpPages) throw new Error("Missing value after --dump-pages");
      continue;
    }
    if (arg === "--diff") {
      diffSlug = slugify(argv[++i] ?? "");
      if (!diffSlug) throw new Error("Missing slug after --diff");
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    if (!existsSync(arg) && !arg.toLowerCase().endsWith(".pdf")) {
      tableKeys.push(slugify(arg));
      continue;
    }
    pdfPath = arg;
  }

  return { pdfPath, tableKeys, list, help, dumpPages, diffSlug };
}

async function readTableGroups() {
  try {
    const raw = await readFile(GROUPS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    /** @type {Map<string, string[]>} */
    const groups = new Map();
    for (const [groupKey, slugs] of Object.entries(parsed)) {
      groups.set(
        slugify(groupKey),
        slugs.map((slug) => slugify(String(slug))),
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

/**
 * @param {typeof profiles} allProfiles
 * @param {string[]} tableKeys
 * @param {Map<string, string[]>} groups
 */
function resolveProfiles(allProfiles, tableKeys, groups) {
  if (tableKeys.length === 0) return allProfiles;

  const bySlug = new Map(allProfiles.map((p) => [String(p.slug), p]));
  /** @type {typeof profiles} */
  const selected = [];
  const seen = new Set();
  /** @type {string[]} */
  const missing = [];

  for (const key of tableKeys) {
    const normalized = slugify(key);
    const groupSlugs = groups.get(normalized);
    if (groupSlugs) {
      for (const slug of groupSlugs) {
        const profile = bySlug.get(slug);
        if (!profile) {
          console.warn(`Skipping ${slug} — no extraction profile (group: ${key})`);
          continue;
        }
        if (!seen.has(slug)) {
          seen.add(slug);
          selected.push(profile);
        }
      }
      continue;
    }

    const profile = bySlug.get(normalized);
    if (!profile) {
      missing.push(key);
      continue;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      selected.push(profile);
    }
  }

  if (missing.length > 0) {
    const availableGroups = [...groups.keys()]
      .map((g) => `  - ${g}  (${groups.get(g)?.length ?? 0} tables)`)
      .join("\n");
    const groupSection = availableGroups
      ? `\n\nSection groups:\n${availableGroups}`
      : "";
    throw new Error(
      `No profiles matched: ${missing.join(", ")}. Use --list.${groupSection}`,
    );
  }

  return selected;
}

/**
 * @param {unknown} row
 */
function normalizeResult(row) {
  const r = /** @type {{ range?: string, name?: string, description?: string }} */ (
    row ?? {}
  );
  return {
    range: String(r.range ?? ""),
    name: String(r.name ?? ""),
    description: String(r.description ?? ""),
  };
}

/**
 * @param {unknown} manifest
 * @returns {ReturnType<typeof normalizeResult>[]}
 */
function normalizeResults(manifest) {
  const results = /** @type {{ results?: unknown[] }} */ (manifest).results ?? [];
  return results.map(normalizeResult);
}

/**
 * @param {unknown} existing
 * @param {unknown} extracted
 */
function resultsEqual(existing, extracted) {
  return (
    JSON.stringify(normalizeResults(existing)) ===
    JSON.stringify(normalizeResults(extracted))
  );
}

/**
 * @param {string} value
 */
function quoteDiffValue(value) {
  const text = String(value ?? "");
  if (!text) return "(empty)";
  if (text.length > 200) return `${text.slice(0, 197)}...`;
  return text;
}

/**
 * @param {unknown} existing
 * @param {unknown} extracted
 * @returns {{ lines: string[], hasDiff: boolean }}
 */
function buildResultsDiff(existing, extracted) {
  const existingRows = normalizeResults(existing);
  const extractedRows = normalizeResults(extracted);
  /** @type {string[]} */
  const lines = [];
  let hasDiff = false;

  if (existingRows.length !== extractedRows.length) {
    hasDiff = true;
    lines.push(
      `- Result count: ${existingRows.length} (manifest) → ${extractedRows.length} (extracted)`,
    );
  }

  const max = Math.max(existingRows.length, extractedRows.length);
  for (let i = 0; i < max; i++) {
    const left = existingRows[i];
    const right = extractedRows[i];

    if (!left && right) {
      hasDiff = true;
      lines.push(`- [${i}] added in extracted`);
      lines.push(`  - range: \`${right.range}\``);
      lines.push(`  - name: ${quoteDiffValue(right.name)}`);
      if (right.description) {
        lines.push(`  - description: ${quoteDiffValue(right.description)}`);
      }
      continue;
    }
    if (left && !right) {
      hasDiff = true;
      lines.push(`- [${i}] removed from extracted`);
      lines.push(`  - range: \`${left.range}\``);
      lines.push(`  - name: ${quoteDiffValue(left.name)}`);
      continue;
    }
    if (!left || !right) continue;

    const fieldDiffs = [];
    if (left.range !== right.range) {
      fieldDiffs.push(
        `range: \`${left.range}\` → \`${right.range}\``,
      );
    }
    if (left.name !== right.name) {
      fieldDiffs.push(
        `name: ${quoteDiffValue(left.name)} → ${quoteDiffValue(right.name)}`,
      );
    }
    if (left.description !== right.description) {
      fieldDiffs.push(
        `description: ${quoteDiffValue(left.description)} → ${quoteDiffValue(right.description)}`,
      );
    }

    if (fieldDiffs.length) {
      hasDiff = true;
      lines.push(`- [${i}] range \`${left.range || right.range}\``);
      for (const field of fieldDiffs) lines.push(`  - ${field}`);
    }
  }

  return { lines, hasDiff };
}

/**
 * @param {string} pdfPath
 * @param {{ created: number, skipped: number, staged: number, failed: number, stagedDiffs: Array<{ slug: string, lines: string[] }> }} summary
 */
function buildStagingDiffReport(pdfPath, summary) {
  const lines = [
    "# Oracle manifest staging diff",
    "",
    `Generated: ${new Date().toISOString()}`,
    `PDF: ${pdfPath}`,
    "",
    "## Summary",
    "",
    `- Created (new manifests): ${summary.created}`,
    `- Unchanged (skipped): ${summary.skipped}`,
    `- Staged (differs from manifest): ${summary.staged}`,
    `- Failed: ${summary.failed}`,
    "",
  ];

  if (!summary.stagedDiffs.length) {
    lines.push("No staged differences — all existing manifests match extracted results.");
    lines.push("");
    return `${lines.join("\n")}\n`;
  }

  lines.push("## Staged tables", "");
  for (const entry of summary.stagedDiffs) {
    lines.push(`### ${entry.slug}`, "");
    lines.push(...entry.lines, "");
  }

  return `${lines.join("\n")}\n`;
}

async function resetStagingDir() {
  if (existsSync(STAGING_DIR)) {
    await rm(STAGING_DIR, { recursive: true, force: true });
  }
  await mkdir(STAGING_DIR, { recursive: true });
}

async function main() {
  const { pdfPath, tableKeys, list, help, dumpPages, diffSlug } = parseArgs(
    process.argv,
  );

  if (help) {
    printHelp();
    return;
  }

  if (list) {
    const groups = await readTableGroups();
    console.log("Extraction profiles:\n");
    for (const p of profiles) {
      console.log(`  ${p.slug}`);
      console.log(`    layout: ${p.layout}`);
      const start = p.startHeading ?? "(page slice)";
      const end = p.endHeading ?? "(end)";
      console.log(`    ${start} → ${end}\n`);
    }
    if (groups.size > 0) {
      console.log("Section groups (extract all tables in a section):\n");
      for (const [groupKey, slugs] of groups) {
        console.log(`  ${groupKey}`);
        console.log(`    ${slugs.join(", ")}\n`);
      }
    }
    return;
  }

  if (!existsSync(pdfPath)) {
    throw new Error(
      `PDF not found at ${pdfPath}\nPlace Fallout-2d20-Wasteland-Wanderer.pdf in docs/reference/source/`,
    );
  }

  const doc = await loadPdf(pdfPath);
  console.log(`PDF: ${pdfPath} (${doc.numPages} pages)`);

  if (dumpPages) {
    for (const pageNum of parsePageSpec(dumpPages)) {
      console.log(`\n--- page ${pageNum} ---`);
      const items = await extractPageItems(doc, pageNum);
      dumpPageItems(items, pageNum);
    }
    return;
  }

  const allItems = await extractAppendixItems(doc);
  const groups = await readTableGroups();
  const selected = resolveProfiles(profiles, tableKeys, groups);

  if (!selected.length) {
    throw new Error(
      `No profiles matched: ${tableKeys.join(", ")}. Use --list.`,
    );
  }

  await mkdir(MANIFEST_DIR, { recursive: true });
  if (!diffSlug) await resetStagingDir();

  const summary = {
    created: 0,
    skipped: 0,
    staged: 0,
    failed: 0,
    /** @type {Array<{ slug: string, lines: string[] }>} */
    stagedDiffs: [],
  };

  for (const profile of selected) {
    const slug = String(profile.slug);
    try {
      const { results, warnings } = parseTableFromProfile(allItems, profile);
      const manifest = buildManifest(profile, results);
      const manifestPath = join(MANIFEST_DIR, `${slug}.json`);
      const stagingPath = join(STAGING_DIR, `${slug}.json`);

      if (diffSlug === slug) {
        try {
          const existing = JSON.parse(await readFile(manifestPath, "utf8"));
          const { lines, hasDiff } = buildResultsDiff(existing, manifest);
          if (!hasDiff) console.log(`${slug}: no differences`);
          else {
            console.log(`${slug}: differences:`);
            for (const line of lines) console.log(line);
          }
        } catch {
          console.log(`${slug}: no existing manifest to diff`);
        }
        continue;
      }

      const manifestExists = existsSync(manifestPath);
      if (!manifestExists) {
        await writeFile(
          manifestPath,
          `${JSON.stringify(manifest, null, 2)}\n`,
          "utf8",
        );
        const warnText = warnings.length ? ` (${warnings.length} warnings)` : "";
        console.log(
          `Created ${manifestPath} (${results.length} results, layout ${profile.layout})${warnText}`,
        );
        for (const w of warnings) console.log(`  warn ${slug}: ${w}`);
        summary.created++;
        continue;
      }

      const existing = JSON.parse(await readFile(manifestPath, "utf8"));
      if (resultsEqual(existing, manifest)) {
        console.log(`Skipped ${slug} (unchanged)`);
        summary.skipped++;
        continue;
      }

      const { lines, hasDiff } = buildResultsDiff(existing, manifest);
      await writeFile(
        stagingPath,
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
      );
      const warnText = warnings.length ? ` (${warnings.length} warnings)` : "";
      console.log(
        `Staged ${stagingPath} (${results.length} results, layout ${profile.layout})${warnText}`,
      );
      for (const w of warnings) console.log(`  warn ${slug}: ${w}`);
      if (hasDiff) {
        summary.staged++;
        summary.stagedDiffs.push({ slug, lines });
      }
    } catch (err) {
      summary.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`FAILED ${slug}: ${msg}`);
    }
  }

  if (!diffSlug) {
    await writeFile(
      STAGING_DIFF_PATH,
      buildStagingDiffReport(pdfPath, summary),
      "utf8",
    );
    console.log(`\nWrote ${STAGING_DIFF_PATH}`);
  }

  console.log(
    `\nExtracted: ${summary.created} created, ${summary.skipped} skipped, ${summary.staged} staged${summary.failed ? `, ${summary.failed} failed` : ""}`,
  );
  if (summary.created || summary.staged) {
    console.log("Review manifests/staging, then: npm run build:oracle");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
