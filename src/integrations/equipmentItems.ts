import type { ResolvedEquipmentLine } from "../wizard/equipmentRules.js";

/** Fallout item compendiums used for starting equipment lookups. */
const EQUIPMENT_ITEM_PACK_IDS = [
  "fallout.weapons",
  "fallout.apparel",
  "fallout.consumables",
  "fallout.ammunition",
  "fallout.miscellany",
  "fallout.robot_modules",
] as const;

/**
 * Wizard pack labels → compendium item names (Fallout uses Title Case; packs often omit "Mod").
 */
const EQUIPMENT_NAME_ALIASES: Record<string, string> = {
  "recon sensors mod": "Recon Sensors",
  "behavioral analysis mod": "Behavioral Analysis Mod",
  "hazard detection mod": "Hazard Detection Mod",
  "integral boiler mod": "Integral Boiler Mod",
  "diagnosis mod": "Diagnosis Mod",
  "standard plating": "Standard Plating",
  "mister gutsy plating": "Mister Gutsy Plating",
  "brotherhood holotags": "Holotags",
  "laser pistol": "Laser Gun",
  "combat knife": "Combat Knife",
  "pincer arm attachment": "Pincer",
  "buzz-saw arm attachment": "Buzz-Saw",
  "flamer arm attachment": "Flamer",
  "laser emitter arm attachment": "Laser Emitter",
  "10mm auto pistol arm": "10mm Auto Pistol",
};

export interface CompendiumItemIndexEntry {
  name: string;
  uuid: string;
  tooltip: string;
  type: string;
}

export interface EquipmentDisplayLine {
  text: string;
  tooltip: string;
  hasCompendium: boolean;
  compendiumUuid?: string;
  compendiumName?: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeTooltipAttr(text: string): string {
  return text.replace(/"/g, "&quot;").replace(/\r/g, "");
}

let cachedIndex: CompendiumItemIndexEntry[] | null = null;

function equipmentLookupCandidates(text: string): string[] {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const out: string[] = [];
  const add = (value: string) => {
    const v = value.trim();
    if (!v) return;
    if (!out.some((existing) => existing.toLowerCase() === v.toLowerCase())) {
      out.push(v);
    }
  };

  add(trimmed);
  const alias = EQUIPMENT_NAME_ALIASES[lower];
  if (alias) add(alias);

  if (/\s+mod$/i.test(trimmed)) {
    add(trimmed.replace(/\s+mod$/i, "").trim());
    const base = trimmed.replace(/\s+mod$/i, "").trim();
    if (base) add(`${base} Mod`);
  } else if (/\bmod\b/i.test(trimmed)) {
    add(`${trimmed} Mod`);
  }

  return out;
}

function pickPreferredMatch(
  lineText: string,
  matches: CompendiumItemIndexEntry[],
): CompendiumItemIndexEntry {
  const lower = lineText.toLowerCase();
  if (/\bmod\b/.test(lower)) {
    const mod = matches.find((m) => m.type === "robot_mod");
    if (mod) return mod;
  }
  if (/plating/.test(lower)) {
    const plating = matches.find((m) => m.type === "robot_armor");
    if (plating) return plating;
  }
  const armor = matches.find((m) => m.type === "robot_armor");
  if (armor && matches.length > 1) return armor;
  return matches[0]!;
}

/**
 * Build a searchable index of gear items from Fallout compendiums (longest names first).
 */
export async function buildEquipmentItemIndex(): Promise<CompendiumItemIndexEntry[]> {
  if (cachedIndex) return cachedIndex;

  const byKey = new Map<string, CompendiumItemIndexEntry>();

  for (const packId of EQUIPMENT_ITEM_PACK_IDS) {
    const pack = game.packs.get(packId);
    if (!pack) continue;

    const index = await pack.getIndex({
      fields: ["uuid", "name", "type", "system.description"],
    });

    for (const entry of index) {
      const name = String(entry.name);
      const type = String((entry as { type?: string }).type ?? "");
      const key = `${type}:${name.toLowerCase()}`;
      const sys = (entry as unknown as { system?: { description?: string } }).system;
      const description = stripHtml(String(sys?.description ?? ""));
      const tooltip = escapeTooltipAttr(
        description ? `${name}\n\n${description}` : name,
      );
      byKey.set(key, {
        name,
        uuid: String((entry as { uuid?: string }).uuid ?? ""),
        tooltip,
        type,
      });
    }
  }

  cachedIndex = Array.from(byKey.values()).sort(
    (a, b) => b.name.length - a.name.length,
  );
  return cachedIndex;
}

function findExactCompendiumMatch(
  name: string,
  index: CompendiumItemIndexEntry[],
): CompendiumItemIndexEntry | undefined {
  for (const candidate of equipmentLookupCandidates(name)) {
    const lower = candidate.toLowerCase();
    const exact = index.filter((item) => item.name.toLowerCase() === lower);
    if (exact.length) {
      return pickPreferredMatch(name, exact);
    }
  }
  return undefined;
}

function findCompendiumMatches(
  text: string,
  index: CompendiumItemIndexEntry[],
): CompendiumItemIndexEntry[] {
  const trimmed = text.trim();
  const candidates = equipmentLookupCandidates(trimmed);

  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    const exact = index.filter((item) => item.name.toLowerCase() === lower);
    if (exact.length) {
      return [pickPreferredMatch(trimmed, exact)];
    }
  }

  const lower = trimmed.toLowerCase();
  const matches: CompendiumItemIndexEntry[] = [];
  const seen = new Set<string>();

  for (const item of index) {
    const key = `${item.type}:${item.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    if (lower.includes(item.name.toLowerCase())) {
      matches.push(item);
      seen.add(key);
    }
  }

  if (!matches.length) return [];
  return [pickPreferredMatch(trimmed, matches)];
}

export function enrichEquipmentLine(
  line: string | ResolvedEquipmentLine,
  index: CompendiumItemIndexEntry[],
): EquipmentDisplayLine {
  const resolved: ResolvedEquipmentLine =
    typeof line === "string" ? { text: line } : line;
  const lookupText = resolved.compendiumName ?? resolved.text;

  const exact = resolved.compendiumName
    ? findExactCompendiumMatch(resolved.compendiumName, index)
    : undefined;
  const matches = exact ? [exact] : findCompendiumMatches(lookupText, index);

  if (!matches.length) {
    return { text: resolved.text, tooltip: "", hasCompendium: false };
  }

  const tooltip = escapeTooltipAttr(
    matches.map((m) => m.tooltip).join("\n\n—\n\n"),
  );

  const primary = matches[0]!;
  return {
    text: resolved.text,
    tooltip,
    hasCompendium: Boolean(primary.uuid),
    compendiumUuid: primary.uuid || undefined,
    compendiumName: matches.map((m) => m.name).join(", "),
  };
}

export function enrichEquipmentLines(
  lines: Array<string | ResolvedEquipmentLine>,
  index: CompendiumItemIndexEntry[],
): EquipmentDisplayLine[] {
  return lines.map((line) => enrichEquipmentLine(line, index));
}
