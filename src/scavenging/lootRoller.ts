import otherFound from "../data/scavenging/creation/other-found-items.json";
import type { LootCategoryKey } from "./ScavengerLocation.js";
import { roll2d20, rollD20 } from "./dice.js";
import { itemUuidFromTableRow } from "./lootItemInteract.js";
import {
  clampLootRollSum,
  lookupLootAtRollSum,
  type TableResultRow,
} from "./rollTableLookup.js";
import {
  findRollTableForCategory,
  getRollTableDisplayName,
  resolveRollTableDocument,
  resolveRollTableKey,
  resolveWeaponSubcategory,
} from "./rollTableRegistry.js";
import { getScavengingSettingBoolean, SCAVENGING_SETTINGS } from "./scavengingSettings.js";

const WEAPON_SUBCATEGORIES: LootCategoryKey[] = [
  "weaponsRanged",
  "weaponsMelee",
  "weaponsThrown",
];

export function rollOtherFoundCategoryDetailed(): {
  d20: number;
  category: LootCategoryKey;
} {
  const d20 = rollD20(1).faces[0]!;
  for (const entry of otherFound.entries as Array<{
    min: number;
    max: number;
    category: string;
  }>) {
    if (d20 >= entry.min && d20 <= entry.max) {
      const cat = entry.category;
      if (cat === "weapons") {
        return { d20, category: resolveWeaponSubcategory() };
      }
      return { d20, category: cat as LootCategoryKey };
    }
  }
  return { d20, category: "junk" };
}

export function rollOtherFoundCategory(): LootCategoryKey {
  return rollOtherFoundCategoryDetailed().category;
}

export type DrawnLoot = {
  label: string;
  rollSum: number;
  itemUuid?: string;
  quantity?: number;
  formula?: string;
  /** Foundry posted the table draw to chat (skip duplicate module message). */
  drewToChat?: boolean;
};

type TableResultRow = {
  type?: string;
  documentUuid?: string;
  name?: string;
  text?: string;
  range?: [number, number];
};

function normalizeRollTableDraw(raw: unknown): { results: TableResultRow[] } {
  if (!raw || typeof raw !== "object") return { results: [] };
  const obj = raw as Record<string, unknown>;
  const inner =
    obj.RollTableDraw && typeof obj.RollTableDraw === "object"
      ? (obj.RollTableDraw as Record<string, unknown>)
      : obj;
  const results = Array.isArray(inner.results) ? (inner.results as TableResultRow[]) : [];
  return { results };
}

function resultLabelFromDraw(
  result: TableResultRow,
  tableKey: LootCategoryKey,
): string {
  const name = result.name?.trim();
  if (name) return name;
  const text = result.text?.trim();
  if (text) return text;
  const key = resolveRollTableKey(tableKey);
  return key ? getRollTableDisplayName(key) : tableKey;
}

async function drawFromFoundryTable(
  category: LootCategoryKey,
  displayChat = true,
): Promise<DrawnLoot | null> {
  const found = await findRollTableForCategory(category);
  if (!found) return null;

  const table = await resolveRollTableDocument(found.ref);
  if (!table?.draw) return null;

  const whisper = getScavengingSettingBoolean(SCAVENGING_SETTINGS.searchRollWhisper);
  const drawRaw = await table.draw({
    displayChat,
    ...(displayChat && whisper ? { messageMode: CONST.DICE_ROLL_MODES.PRIVATE } : {}),
  });
  const { results, rollTotal } = normalizeRollTableDraw(drawRaw);
  const picked =
    results.find((r) => r.type === "document" || r.documentUuid) ?? results[0];
  if (!picked) {
    return {
      label: `(No result on ${found.name})`,
      rollSum: 0,
      drewToChat: displayChat,
    };
  }

  const range = picked.range;
  const rollSum =
    rollTotal ??
    (range
      ? Math.round((Math.min(range[0]!, range[1]!) + Math.max(range[0]!, range[1]!)) / 2)
      : 0);

  return {
    label: resultLabelFromDraw(picked, found.tableKey),
    rollSum: clampLootRollSum(category, rollSum),
    itemUuid: itemUuidFromTableRow(picked),
    drewToChat: displayChat,
  };
}

export async function rollLootCategory(
  category: LootCategoryKey,
  luckShift = 0,
  options?: { displayChat?: boolean },
): Promise<DrawnLoot> {
  const tableCategory: LootCategoryKey =
    category === "weapons" ? resolveWeaponSubcategory() : category;

  if (getScavengingSettingBoolean(SCAVENGING_SETTINGS.preferFoundryTables)) {
    const drawn = await drawFromFoundryTable(
      tableCategory,
      options?.displayChat !== false,
    );
    if (drawn && drawn.rollSum > 0) {
      if (luckShift !== 0) {
        const base = drawn.rollSum;
        const shifted = await lookupLootAtRollSum(tableCategory, base + luckShift);
        return {
          label: shifted.label,
          rollSum: shifted.rollSum,
          itemUuid: shifted.itemUuid,
          drewToChat: drawn.drewToChat,
        };
      }
      return drawn;
    }
  }

  if (tableCategory === "junk") {
    let rollSum = roll2d20().sum;
    rollSum = Math.max(2, Math.min(40, rollSum + luckShift));
    return {
      label: `${rollSum} junk items`,
      rollSum,
      quantity: rollSum,
    };
  }

  const tableKey = resolveRollTableKey(tableCategory);
  const displayName = tableKey
    ? getRollTableDisplayName(tableKey)
    : tableCategory;
  return {
    label: `(Roll Table "${displayName}" not found in world)`,
    rollSum: 0,
  };
}

export function getLoadedLootTableIds(): string[] {
  return WEAPON_SUBCATEGORIES;
}
