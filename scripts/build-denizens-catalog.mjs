#!/usr/bin/env node
/**
 * Rebuild src/data/scavenging/denizens-catalog.json from local Foundry exports.
 *
 * Source (gitignored): src/data/denizens/*.json
 * Output (committed):  src/data/scavenging/denizens-catalog.json
 *
 * Always replaces the catalog file (never merges with a previous catalog).
 * Run after adding/updating actor exports: npm run build:denizens
 */
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  dedupeDenizenCatalog,
  isRobotNpcExport,
  normalizeFalloutBodyType,
  normalizeRobotExportJson,
  parseDenizenFromActorJson,
} from "../src/scavenging/denizenCatalogParse.ts";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SOURCE_DIR = join(ROOT, "src/data/denizens");
const OUT_PATH = join(ROOT, "src/data/scavenging/denizens-catalog.json");

function normalizeExportJson(data) {
  const system = data.system;
  if (!system || typeof system !== "object") return false;

  let changed = false;
  if (isRobotNpcExport(data) && data.type !== "robot") {
    if (system.bodyType !== "robot") {
      system.bodyType = "robot";
      changed = true;
    }
  } else if (typeof system.bodyType === "string") {
    const normalized = normalizeFalloutBodyType(system.bodyType);
    if (system.bodyType !== normalized) {
      system.bodyType = normalized;
      changed = true;
    }
  }
  if (normalizeRobotExportJson(data)) {
    changed = true;
  }
  return changed;
}

async function writeCatalog(denizens) {
  const catalog = {
    generatedAt: new Date().toISOString(),
    source:
      "Built from src/data/denizens/*.json — commit denizens-catalog.json; raw exports stay gitignored",
    denizens,
  };
  const body = `${JSON.stringify(catalog, null, 2)}\n`;

  try {
    await unlink(OUT_PATH);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== "ENOENT") throw err;
  }

  await writeFile(OUT_PATH, body, { encoding: "utf8", flag: "w" });
}

async function main() {
  const files = (await readdir(SOURCE_DIR)).filter((f) => f.endsWith(".json"));
  if (!files.length) {
    console.error(`No JSON files in ${SOURCE_DIR}`);
    process.exit(1);
  }

  const parsed = [];
  let exportsUpdated = 0;

  for (const filename of files.sort()) {
    const filePath = join(SOURCE_DIR, filename);
    const raw = await readFile(filePath, "utf8");
    const data = JSON.parse(raw);

    if (normalizeExportJson(data)) {
      await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, {
        encoding: "utf8",
        flag: "w",
      });
      exportsUpdated += 1;
    }

    const entry = parseDenizenFromActorJson(filename, data);
    if (entry) parsed.push(entry);
  }

  const denizens = dedupeDenizenCatalog(parsed);
  await writeCatalog(denizens);

  console.log(
    `Overwrote ${OUT_PATH} with ${denizens.length} denizens (${files.length} export files read).`,
  );
  if (exportsUpdated) {
    console.log(
      `Updated ${exportsUpdated} export file(s) in ${SOURCE_DIR} (bodyType / robot defaults).`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
