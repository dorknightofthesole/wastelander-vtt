#!/usr/bin/env node
/**
 * ApplicationV2 actions must reference public static handlers — private static
 * methods throw "Cannot read from private field" when Foundry invokes them.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.name.endsWith("App.ts") || entry.name === "CombatDiceRollDialog.ts") {
      out.push(path);
    }
  }
  return out;
}

let filesChanged = 0;
for (const file of walk(SRC)) {
  let text = readFileSync(file, "utf8");
  const before = text;
  text = text.replace(/static async #on/g, "static async on");
  text = text.replace(/static #on/g, "static on");
  // ClassName.#on in actions maps only — not instance private this.#on*
  text = text.replace(/([A-Z][\w]*)\.#on/g, "$1.on");
  if (text !== before) {
    writeFileSync(file, text);
    filesChanged += 1;
    console.log("patched", file.replace(ROOT + "/", ""));
  }
}
console.log(`Done. ${filesChanged} file(s) updated.`);
