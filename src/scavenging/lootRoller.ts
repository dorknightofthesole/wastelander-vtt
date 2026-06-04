import otherFound from "../data/scavenging/creation/other-found-items.json";
import type { LootCategoryKey } from "./ScavengerLocation.js";
import { roll2d20, roll3d20, rollD20 } from "./dice.js";
import {
  findRollTableForCategory,
  getRollTableDisplayName,
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

type DrawnLoot = {
  label: string;
  rollSum: number;
  quantity?: number;
  formula?: string;
};

function resultLabelFromDraw(
  result: { name?: string; text?: string },
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
): Promise<DrawnLoot | null> {
  const found = findRollTableForCategory(category);
  if (!found) return null;

  const table = (game as { tables?: { get?: (id: string) => RollTableDoc } }).tables?.get?.(
    found.id,
  );
  if (!table?.draw) return null;

  const draw = await table.draw({ displayChat: false });
  const results = draw.results ?? [];
  const picked =
    results.find((r) => r.type === "document" || r.documentUuid) ??
    results[0];
  if (!picked) {
    return {
      label: `(No result on ${found.name})`,
      rollSum: 0,
    };
  }

  return {
    label: resultLabelFromDraw(picked, found.tableKey),
    rollSum: picked.range?.[0] ?? 0,
  };
}

type RollTableDoc = {
  draw: (options?: { displayChat?: boolean }) => Promise<{
    results?: Array<{
      type?: string;
      documentUuid?: string;
      name?: string;
      text?: string;
      range?: [number, number];
    }>;
  }>;
};

export async function rollLootCategory(
  category: LootCategoryKey,
  luckShift = 0,
): Promise<DrawnLoot> {
  const tableCategory =
    category === "weapons" ? resolveWeaponSubcategory() : category;

  if (getScavengingSettingBoolean(SCAVENGING_SETTINGS.preferFoundryTables)) {
    const drawn = await drawFromFoundryTable(tableCategory);
    if (drawn) {
      if (luckShift !== 0 && drawn.rollSum > 0) {
        drawn.rollSum = Math.max(2, Math.min(40, drawn.rollSum + luckShift));
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
