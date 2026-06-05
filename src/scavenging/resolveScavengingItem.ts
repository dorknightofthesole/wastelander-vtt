import { MODULE_ID, WASTELANDER_ITEMS_PACK } from "../constants.js";
import compendiumNames from "../data/scavenging/loot/compendium-names.json";
import {
  buildEquipmentItemIndex,
  findExactCompendiumMatch,
  type CompendiumItemIndexEntry,
} from "../integrations/equipmentItems.js";

const NAME_MAP = compendiumNames as Record<string, Record<string, string>>;

const PREFERRED_PACKS: Record<string, string[]> = {
  food: [WASTELANDER_ITEMS_PACK, "fallout.consumables"],
  beverages: [WASTELANDER_ITEMS_PACK, "fallout.consumables"],
  chems: [WASTELANDER_ITEMS_PACK, "fallout.consumables"],
  ammunition: [WASTELANDER_ITEMS_PACK, "fallout.ammunition"],
};

export type ResolvedScavengingItem = {
  name: string;
  uuid: string;
  documentCollection: string;
  documentId: string;
};

/** `Compendium.fallout.consumables.Item.<_id>` → pack id + document _id. */
function parseCompendiumUuid(
  uuid: string,
): { documentCollection: string; documentId: string } | null {
  const parts = uuid.split(".");
  if (parts.length < 5 || parts[0] !== "Compendium") return null;
  const documentClass = parts[3];
  const documentId = parts[4];
  if (!documentClass || !documentId) return null;
  return {
    documentCollection: `${parts[1]}.${parts[2]}`,
    documentId,
  };
}

function pickFromPreferredPacks(
  matches: CompendiumItemIndexEntry[],
  preferredPacks: string[],
): CompendiumItemIndexEntry | undefined {
  for (const packId of preferredPacks) {
    const prefix = `Compendium.${packId}.`;
    const hit = matches.find((m) => m.uuid.startsWith(prefix));
    if (hit) return hit;
  }
  return matches[0];
}

function lookupCompendiumName(tableId: string, label: string): string {
  return NAME_MAP[tableId]?.[label] ?? label;
}

export async function buildScavengingItemIndex(): Promise<CompendiumItemIndexEntry[]> {
  return buildEquipmentItemIndex();
}

export function resolveScavengingItemFromIndex(
  tableId: string,
  label: string,
  index: CompendiumItemIndexEntry[],
): ResolvedScavengingItem | null {
  const compendiumName = lookupCompendiumName(tableId, label);
  const preferredPacks = PREFERRED_PACKS[tableId] ?? [];

  const exact = findExactCompendiumMatch(compendiumName, index);
  if (!exact?.uuid) return null;

  const matches = index.filter(
    (item) => item.name.toLowerCase() === exact.name.toLowerCase(),
  );
  const chosen =
    matches.length > 1
      ? pickFromPreferredPacks(matches, preferredPacks) ?? exact
      : exact;

  const parsed = parseCompendiumUuid(chosen.uuid);
  if (!parsed) return null;

  return {
    name: chosen.name,
    uuid: chosen.uuid,
    documentCollection: parsed.documentCollection,
    documentId: parsed.documentId,
  };
}

export function scavengingResultFlags(quantityFormula?: string): Record<string, unknown> {
  if (!quantityFormula) return {};
  return {
    [MODULE_ID]: { quantityFormula },
  };
}
