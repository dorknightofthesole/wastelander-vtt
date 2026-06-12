import otherFound from "../data/scavenging/creation/other-found-items.json";
import { t } from "../integrations/i18n.js";
import { roll2d20, rollD20 } from "./dice.js";
import type { LootCategoryKey, ScavengerLocation } from "./ScavengerLocation.js";
import { itemUuidFromTableRow } from "./lootItemInteract.js";
import {
  clampLootRollSum,
  collectTableResultRows,
  executeRollTableDraw,
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
import { findSceneRollTableForCategory } from "./sceneLootTables.js";
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
  /** Concrete table category used for the draw. */
  tableCategory?: LootCategoryKey;
  /** Foundry posted the table draw to chat (skip duplicate module message). */
  drewToChat?: boolean;
};

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

async function drawFromRollTableDocument(
  table: RollTable,
  category: LootCategoryKey,
  displayChat: boolean,
  luckShift: number,
): Promise<DrawnLoot> {
  const whisper = getScavengingSettingBoolean(SCAVENGING_SETTINGS.searchRollWhisper);
  const outcome = await executeRollTableDraw(table, {
    displayChat,
    drawOptions:
      displayChat && whisper
        ? { messageMode: CONST.DICE_ROLL_MODES.PRIVATE }
        : undefined,
  });
  const picked =
    outcome.rows.find((r) => r.type === "document" || r.documentUuid) ??
    outcome.rows[0];

  if (!picked || outcome.label.startsWith("(No result on ")) {
    return {
      label: outcome.label || `(No result on ${table.name})`,
      rollSum: 0,
      drewToChat: outcome.drewToChat,
      tableCategory: category,
    };
  }

  const range = picked.range;
  let rollSum =
    outcome.rollTotal ||
    (range
      ? Math.round((Math.min(range[0]!, range[1]!) + Math.max(range[0]!, range[1]!)) / 2)
      : 0);
  rollSum = clampLootRollSum(category, rollSum);

  const tableRows = collectTableResultRows(table);
  let label = outcome.label || resultLabelFromDraw(picked, category);
  let itemUuid = itemUuidFromTableRow(picked);
  let resolvedSum = rollSum;

  if (luckShift !== 0) {
    const shifted = await lookupLootAtRollSum(
      category,
      rollSum + luckShift,
      tableRows,
    );
    label = shifted.label;
    itemUuid = shifted.itemUuid;
    resolvedSum = shifted.rollSum;
  }

  return {
    label,
    rollSum: resolvedSum,
    itemUuid,
    tableCategory: category,
    drewToChat: outcome.drewToChat,
  };
}

async function drawFromSceneTable(
  location: ScavengerLocation,
  category: LootCategoryKey,
  luckShift: number,
  displayChat: boolean,
): Promise<DrawnLoot | null> {
  if (category === "junk") return null;

  const rollCategory: LootCategoryKey =
    category === "weapons"
      ? location.sceneLoot?.weaponsTableKey ?? resolveWeaponSubcategory()
      : category;

  const table = findSceneRollTableForCategory(location, category);
  if (!table?.draw) {
    const tableKey = resolveRollTableKey(rollCategory);
    const displayName = tableKey
      ? getRollTableDisplayName(tableKey)
      : rollCategory;
    return {
      label: t("WASTELANDER.Scavenging.Loot.NoSceneTable", { name: displayName }),
      rollSum: 0,
    };
  }

  return drawFromRollTableDocument(table, rollCategory, displayChat, luckShift);
}

async function drawFromFoundryTable(
  category: LootCategoryKey,
  displayChat = true,
  luckShift = 0,
): Promise<DrawnLoot | null> {
  const found = await findRollTableForCategory(category);
  if (!found) return null;

  const table = await resolveRollTableDocument(found.ref);
  if (!table?.draw) return null;

  return drawFromRollTableDocument(table, category, displayChat, luckShift);
}

export async function rollLootCategory(
  category: LootCategoryKey,
  luckShift = 0,
  options?: { displayChat?: boolean; location?: ScavengerLocation },
): Promise<DrawnLoot> {
  const pinnedWeaponKey = options?.location?.sceneLoot?.weaponsTableKey;
  const tableCategory: LootCategoryKey =
    category === "weapons"
      ? pinnedWeaponKey ?? resolveWeaponSubcategory()
      : category;
  const displayChat = options?.displayChat !== false;

  if (options?.location) {
    if (tableCategory === "junk") {
      let rollSum = roll2d20().sum;
      rollSum = Math.max(2, Math.min(40, rollSum + luckShift));
      return {
        label: `${rollSum} junk items`,
        rollSum,
        quantity: rollSum,
      };
    }

    if (
      options.location.sceneLoot?.folderId ||
      (options.location.sceneLoot?.slots?.length ?? 0) > 0
    ) {
      const drawn = await drawFromSceneTable(
        options.location,
        category,
        luckShift,
        displayChat,
      );
      if (drawn) return drawn;
    }
  }

  if (getScavengingSettingBoolean(SCAVENGING_SETTINGS.preferFoundryTables)) {
    const drawn = await drawFromFoundryTable(tableCategory, displayChat, luckShift);
    if (drawn && drawn.rollSum > 0) return drawn;
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
