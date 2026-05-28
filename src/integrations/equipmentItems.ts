/** Fallout item compendiums used for starting equipment lookups. */
const EQUIPMENT_ITEM_PACK_IDS = [
  "fallout.weapons",
  "fallout.apparel",
  "fallout.consumables",
  "fallout.ammunition",
  "fallout.miscellany",
] as const;

export interface CompendiumItemIndexEntry {
  name: string;
  uuid: string;
  tooltip: string;
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

/**
 * Build a searchable index of gear items from Fallout compendiums (longest names first).
 */
export async function buildEquipmentItemIndex(): Promise<CompendiumItemIndexEntry[]> {
  if (cachedIndex) return cachedIndex;

  const byName = new Map<string, CompendiumItemIndexEntry>();

  for (const packId of EQUIPMENT_ITEM_PACK_IDS) {
    const pack = game.packs.get(packId);
    if (!pack) continue;

    const index = await pack.getIndex({
      fields: ["uuid", "name", "system.description"],
    });

    for (const entry of index) {
      const name = String(entry.name);
      const sys = (entry as unknown as { system?: { description?: string } }).system;
      const description = stripHtml(String(sys?.description ?? ""));
      const tooltip = escapeTooltipAttr(
        description ? `${name}\n\n${description}` : name,
      );
      byName.set(name.toLowerCase(), {
        name,
        uuid: String((entry as { uuid?: string }).uuid ?? ""),
        tooltip,
      });
    }
  }

  cachedIndex = Array.from(byName.values()).sort(
    (a, b) => b.name.length - a.name.length,
  );
  return cachedIndex;
}

function findCompendiumMatches(
  text: string,
  index: CompendiumItemIndexEntry[],
): CompendiumItemIndexEntry[] {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  const exact = index.find((item) => item.name.toLowerCase() === lower);
  if (exact) return [exact];

  const matches: CompendiumItemIndexEntry[] = [];
  const seen = new Set<string>();

  for (const item of index) {
    const key = item.name.toLowerCase();
    if (seen.has(key)) continue;
    if (lower.includes(key)) {
      matches.push(item);
      seen.add(key);
    }
  }

  return matches;
}

export function enrichEquipmentLine(
  text: string,
  index: CompendiumItemIndexEntry[],
): EquipmentDisplayLine {
  const matches = findCompendiumMatches(text, index);
  if (!matches.length) {
    return { text, tooltip: "", hasCompendium: false };
  }

  const tooltip = escapeTooltipAttr(
    matches.map((m) => m.tooltip).join("\n\n—\n\n"),
  );

  const primary = matches[0]!;
  return {
    text,
    tooltip,
    hasCompendium: Boolean(primary.uuid),
    compendiumUuid: primary.uuid || undefined,
    compendiumName: matches.map((m) => m.name).join(", "),
  };
}

export function enrichEquipmentLines(
  lines: string[],
  index: CompendiumItemIndexEntry[],
): EquipmentDisplayLine[] {
  return lines.map((line) => enrichEquipmentLine(line, index));
}
