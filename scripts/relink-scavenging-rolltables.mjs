#!/usr/bin/env node
/**
 * Relink scavenging roll-table document results to Fallout system compendium UUIDs.
 *
 * Usage:
 *   npm run relink:scavenging-tables
 *
 * Requires Foundry closed (no LOCK on packs). Uses @foundryvtt/foundryvtt-cli to
 * unpack → patch YAML → repack wastelander-rollable-tables.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const REPO_TABLES_PACK = join(ROOT, "packs/wastelander-rollable-tables");
const FALLOUT_PACKS_ROOT =
  process.env.FALLOUT_PACKS ??
  join(
    process.env.HOME ?? "",
    "Library/Application Support/FoundryVTT/Data/systems/fallout/packs",
  );
const WASTELANDER_ITEMS_PACK = join(ROOT, "packs/wastelander-items");

const WORK = join(ROOT, ".cache/relink-scavenging-tables");
const TABLES_YAML = join(WORK, "tables-yaml");
const TABLES_PACK_STAGING = join(WORK, "tables-pack-staging");
const FALLOUT_PACKS_COPY = join(WORK, "fallout-packs");

const FALLOUT_ITEM_PACKS = [
  "ammunition",
  "consumables",
  "weapons",
  "apparel",
  "miscellany",
  "robot_modules",
];

const TABLE_PACK_PREFERENCE = [
  { test: /ammunition/i, packs: ["ammunition"] },
  { test: /food|beverage|chem|nuka|foraging/i, packs: ["consumables"] },
  { test: /weapon/i, packs: ["weapons"] },
  { test: /armor|clothing|apparel|power_armor|t_45|t_51|t_60|x_01/i, packs: ["apparel"] },
  { test: /oddit/i, packs: ["miscellany", "robot_modules", "consumables"] },
];

const EXTRA_ALIASES = {
  "melon non-irradated": "Melon",
  "carrot non-irradated": "Carrot",
  "corn non-irradated": "Corn",
  "mutfruit non-irradated": "Mutfruit",
  "fancy lads snack cakes (preserved)": "Fancy Lads Snack Cakes (preserved)",
  "2mm ec": "2mm Electromagnetic Cartridge",
  ".50 ammo": ".50 Round",
  "5mm": "5mm Round",
  "10mm": "10mm Round",
  ".38 ammo": ".38 Round",
  ".45 rounds": ".45 Round",
  ".308 ammo": ".308 Round",
  "5.56mm": "5.56mm Round",
  ".44 magnum": ".44 Magnum Round",
  "shotgun shells": "Shotgun Shell",
  "laser rifle": "Laser Rifle",
  "railway rifle": "Railway Rifle",
  "stealth boy": "Stealth Boy",
  "pulse mine": "Pulse Mine",
  "frag mine": "Frag Mine",
  "behavioral analysis mod": "Behavioral Analysis Mod",
  "hazard detection mod": "Hazard Detection Mod",
  "integral boiler mod": "Integral Boiler Mod",
  "diagnosis mod": "Diagnosis Mod",
  "recon sensors": "Recon Sensors",
  "hacking mod": "Hacking Mod",
  "lockpick module": "Lockpick Module",
  "mini-nuke": "Mini-Nuke",
};

function runFvtt(args) {
  const result = spawnSync("npx", ["--yes", "@foundryvtt/foundryvtt-cli", "package", ...args], {
    stdio: "inherit",
    cwd: ROOT,
  });
  if (result.status !== 0) {
    throw new Error(`fvtt package ${args.join(" ")} failed (${result.status})`);
  }
}

function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadAliasMap() {
  const aliases = new Map();
  const add = (from, to) => {
    const key = normalizeName(from);
    const val = String(to).trim();
    if (key && val) aliases.set(key, val);
  };

  for (const [from, to] of Object.entries(EXTRA_ALIASES)) add(from, to);

  const compendiumNames = loadJson(
    join(ROOT, "src/data/scavenging/loot/compendium-names.json"),
  );
  for (const table of Object.values(compendiumNames)) {
    for (const [label, name] of Object.entries(table)) add(label, name);
  }

  for (const file of ["food.json", "ammunition.json"]) {
    const path = join(ROOT, "src/data/scavenging/loot", file);
    if (!existsSync(path)) continue;
    const data = loadJson(path);
    for (const entry of data.entries ?? []) {
      if (entry.label) add(entry.label, entry.label);
    }
  }

  return aliases;
}

function inferPreferredPacks(label, tableFile) {
  const lower = normalizeName(label);
  if (/\b(round|rounds|ammo|ammunition|cartridge|shell|missile|spike|core|fuel|flare)\b/.test(lower)) {
    return ["ammunition"];
  }
  if (
    /\b(pistol|rifle|gun|revolver|shotgun|knife|machete|bat|sword|axe|mine|grenade|launcher)\b/.test(
      lower,
    )
  ) {
    return ["weapons"];
  }
  if (/\b(armor|outfit|clothing|suit|helmet|mask|robes|coveralls)\b/.test(lower)) {
    return ["apparel"];
  }
  if (/\b(stimpak|chem|nuka|food|water|beer|wine|steak|corn|mutfruit)\b/.test(lower)) {
    return ["consumables"];
  }

  const tableStem = basename(tableFile, ".yml");
  for (const rule of TABLE_PACK_PREFERENCE) {
    if (rule.test.test(tableStem)) return rule.packs;
  }
  return FALLOUT_ITEM_PACKS;
}

function lookupCandidates(label, aliases) {
  const out = [];
  const add = (value) => {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) return;
    if (!out.some((v) => normalizeName(v) === normalizeName(trimmed))) out.push(trimmed);
  };

  add(label);
  const alias = aliases.get(normalizeName(label));
  if (alias) add(alias);

  return out;
}

function buildItemIndex(yamlDirs) {
  /** @type {Map<string, Array<{ name: string; uuid: string; pack: string; type: string }>>} */
  const byName = new Map();

  for (const { packId, moduleId, dir } of yamlDirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".yml"))) {
      const doc = parseYaml(readFileSync(join(dir, file), "utf8"));
      const name = String(doc?.name ?? "").trim();
      const id = String(doc?._id ?? "").trim();
      const type = String(doc?.type ?? "").trim();
      if (!name || !id) continue;
      const uuid = `Compendium.${moduleId}.${packId}.Item.${id}`;
      const key = normalizeName(name);
      const row = { name, uuid, pack: packId, type };
      const list = byName.get(key) ?? [];
      list.push(row);
      byName.set(key, list);
    }
  }

  return byName;
}

function pickMatch(candidates, preferredPacks, byName) {
  for (const candidate of candidates) {
    const matches = byName.get(normalizeName(candidate));
    if (!matches?.length) continue;

    for (const packId of preferredPacks) {
      const hit = matches.find((m) => m.pack === packId);
      if (hit) return hit;
    }
    for (const packId of ["wastelander-items", ...FALLOUT_ITEM_PACKS]) {
      const hit = matches.find((m) => m.pack === packId);
      if (hit) return hit;
    }
    return matches[0];
  }
  return null;
}

function preferredPacksForTable(file) {
  const stem = basename(file, ".yml");
  for (const rule of TABLE_PACK_PREFERENCE) {
    if (rule.test.test(stem)) return [...rule.packs, "wastelander-items"];
  }
  return [...FALLOUT_ITEM_PACKS, "wastelander-items"];
}

function shouldRelink(uuid) {
  if (!uuid) return true;
  if (uuid.startsWith("Item.")) return true;
  if (uuid.startsWith("Compendium.wastelander.")) return false;
  if (uuid.startsWith("Compendium.fallout.")) return false;
  return true;
}

function unpackPacks() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });

  cpSync(REPO_TABLES_PACK, join(TABLES_PACK_STAGING, "wastelander-rollable-tables"), {
    recursive: true,
  });
  rmSync(join(TABLES_PACK_STAGING, "wastelander-rollable-tables", "unpack"), {
    recursive: true,
    force: true,
  });
  rmSync(join(REPO_TABLES_PACK, "unpack"), { recursive: true, force: true });
  const lock = join(TABLES_PACK_STAGING, "wastelander-rollable-tables", "LOCK");
  if (existsSync(lock)) {
    throw new Error(
      "Foundry appears to have wastelander-rollable-tables open (LOCK file present). Close Foundry and re-run.",
    );
  }

  runFvtt([
    "unpack",
    "-n",
    "wastelander-rollable-tables",
    "--in",
    TABLES_PACK_STAGING,
    "--out",
    TABLES_YAML,
    "--compendiumType",
    "RollTable",
    "--yaml",
    "--clean",
  ]);

  const unpackedTables = countYamlTables(TABLES_YAML);
  if (unpackedTables < 20) {
    throw new Error(
      `Source wastelander-rollable-tables pack unpacked only ${unpackedTables} documents. ` +
        `Close Foundry (remove LOCK), restore the pack, then re-run.`,
    );
  }
  console.log(`Unpacked ${unpackedTables} roll-table documents.`);

  mkdirSync(FALLOUT_PACKS_COPY, { recursive: true });
  for (const pack of FALLOUT_ITEM_PACKS) {
    const src = join(FALLOUT_PACKS_ROOT, pack);
    if (!existsSync(src)) throw new Error(`Missing Fallout pack: ${src}`);
    cpSync(src, join(FALLOUT_PACKS_COPY, pack), { recursive: true });
    const packLock = join(FALLOUT_PACKS_COPY, pack, "LOCK");
    if (existsSync(packLock)) rmSync(packLock);
  }

  /** @type {Array<{ packId: string; moduleId: string; dir: string }>} */
  const yamlDirs = [];

  for (const pack of FALLOUT_ITEM_PACKS) {
    const out = join(WORK, `fallout-yaml-${pack}`);
    runFvtt([
      "unpack",
      "-n",
      pack,
      "--in",
      FALLOUT_PACKS_COPY,
      "--out",
      out,
      "--compendiumType",
      "Item",
      "--yaml",
      "--clean",
    ]);
    yamlDirs.push({ packId: pack, moduleId: "fallout", dir: out });
  }

  if (existsSync(WASTELANDER_ITEMS_PACK)) {
    const moduleStaging = join(WORK, "module-packs");
    cpSync(WASTELANDER_ITEMS_PACK, join(moduleStaging, "wastelander-items"), {
      recursive: true,
    });
    rmSync(join(moduleStaging, "wastelander-items", "LOCK"), { force: true });
    const out = join(WORK, "wastelander-items-yaml");
    runFvtt([
      "unpack",
      "-n",
      "wastelander-items",
      "--in",
      moduleStaging,
      "--out",
      out,
      "--compendiumType",
      "Item",
      "--yaml",
      "--clean",
    ]);
    yamlDirs.push({ packId: "wastelander-items", moduleId: "wastelander", dir: out });
  }

  return yamlDirs;
}

function patchTables(byName, aliases) {
  const stats = {
    tables: 0,
    documentResults: 0,
    relinked: 0,
    alreadyCompendium: 0,
    skippedText: 0,
    unmatched: [],
  };

  for (const file of readdirSync(TABLES_YAML).filter((f) => f.endsWith(".yml"))) {
    const path = join(TABLES_YAML, file);
    const doc = parseYaml(readFileSync(path, "utf8"));
    if (!Array.isArray(doc?.results)) continue;
    stats.tables += 1;
    const tablePreferred = preferredPacksForTable(file);

    for (const result of doc.results) {
      if (result?.type !== "document") {
        stats.skippedText += 1;
        continue;
      }
      stats.documentResults += 1;
      const label = String(result.name ?? "").trim();
      const current = String(result.documentUuid ?? "").trim();

      if (!shouldRelink(current)) {
        stats.alreadyCompendium += 1;
        continue;
      }

      const preferred = [
        ...new Set([
          ...inferPreferredPacks(label, file),
          ...tablePreferred,
        ]),
      ];
      const match = pickMatch(lookupCandidates(label, aliases), preferred, byName);
      if (!match) {
        stats.unmatched.push({ table: doc.name ?? file, label, was: current || "(none)" });
        continue;
      }

      if (match.uuid !== current) {
        result.documentUuid = match.uuid;
        stats.relinked += 1;
      }
    }

    writeFileSync(path, stringifyYaml(doc, { lineWidth: 0 }));
  }

  return stats;
}

function countYamlTables(dir) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith(".yml")).length;
}

function assertPackHasData(packDir, label) {
  const ldbFiles = readdirSync(packDir).filter((f) => f.endsWith(".ldb"));
  if (!ldbFiles.length) {
    throw new Error(`${label}: no .ldb files in ${packDir}`);
  }
  const totalBytes = ldbFiles.reduce(
    (sum, file) => sum + readFileSync(join(packDir, file)).length,
    0,
  );
  if (totalBytes < 1024) {
    throw new Error(`${label}: pack data looks empty (${totalBytes} bytes)`);
  }
}

function verifyPackRoundTrip(packDir) {
  const staging = join(WORK, "verify-pack-staging");
  const yamlOut = join(WORK, "verify-pack-yaml");
  rmSync(staging, { recursive: true, force: true });
  rmSync(yamlOut, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  cpSync(packDir, join(staging, "wastelander-rollable-tables"), { recursive: true });
  rmSync(join(staging, "wastelander-rollable-tables", "LOCK"), { force: true });

  runFvtt([
    "unpack",
    "-n",
    "wastelander-rollable-tables",
    "--in",
    staging,
    "--out",
    yamlOut,
    "--compendiumType",
    "RollTable",
    "--yaml",
    "--clean",
  ]);

  const count = countYamlTables(yamlOut);
  if (count < 20) {
    throw new Error(
      `Repacked compendium verification failed: expected ≥20 tables, found ${count}`,
    );
  }
  return count;
}

function repackTables() {
  const tableCount = countYamlTables(TABLES_YAML);
  if (tableCount < 20) {
    throw new Error(
      `Refusing to repack: only ${tableCount} table YAML files (source pack may be corrupt). ` +
        `Restore from .cache/relink-scavenging-tables/tables-yaml or re-export from Foundry.`,
    );
  }

  const outStaging = join(WORK, "tables-repack-staging");
  rmSync(outStaging, { recursive: true, force: true });
  mkdirSync(outStaging, { recursive: true });

  runFvtt([
    "pack",
    "-n",
    "wastelander-rollable-tables",
    "--in",
    TABLES_YAML,
    "--out",
    outStaging,
    "--compendiumType",
    "RollTable",
    "--yaml",
    "--clean",
  ]);

  const built = join(outStaging, "wastelander-rollable-tables");
  if (!existsSync(built)) {
    throw new Error(`Expected repacked folder at ${built}`);
  }

  assertPackHasData(built, "Repacked pack");
  const verified = verifyPackRoundTrip(built);
  console.log(`Verified repacked compendium (${verified} documents).`);

  const backup = `${REPO_TABLES_PACK}.bak`;
  if (existsSync(REPO_TABLES_PACK)) {
    rmSync(backup, { recursive: true, force: true });
    cpSync(REPO_TABLES_PACK, backup, { recursive: true });
  }

  rmSync(REPO_TABLES_PACK, { recursive: true, force: true });
  cpSync(built, REPO_TABLES_PACK, { recursive: true });
  rmSync(join(REPO_TABLES_PACK, "LOCK"), { force: true });
}

function main() {
  console.log("Unpacking compendiums…");
  const yamlDirs = unpackPacks();
  const aliases = loadAliasMap();
  const byName = buildItemIndex(yamlDirs);

  console.log(`Indexed ${byName.size} unique item names from Fallout + Wastelander packs.`);
  console.log("Patching roll-table results…");
  const stats = patchTables(byName, aliases);

  console.log("\nRelink summary:");
  console.log(`  Tables processed:        ${stats.tables}`);
  console.log(`  Document results:        ${stats.documentResults}`);
  console.log(`  Already compendium UUID: ${stats.alreadyCompendium}`);
  console.log(`  Relinked:                ${stats.relinked}`);
  console.log(`  Unmatched:               ${stats.unmatched.length}`);

  if (stats.unmatched.length) {
    console.log("\nUnmatched results (need manual link or alias):");
    for (const row of stats.unmatched) {
      console.log(`  [${row.table}] ${row.label} (was ${row.was})`);
    }
  }

  console.log("\nRepacking wastelander-rollable-tables…");
  repackTables();
  console.log(`Done. Updated pack at ${REPO_TABLES_PACK}`);
}

main();
