import type { LootCategoryKey, ScavengerLocation } from "./ScavengerLocation.js";
import { itemUuidFromTableRow } from "./lootItemInteract.js";
import { findSceneRollTableForCategory } from "./sceneLootTables.js";
import {
  findRollTableForCategory,
  getRollTableDisplayName,
  resolveRollTableDocument,
  resolveRollTableKey,
  type ScavengingRollTableKey,
} from "./rollTableRegistry.js";

export type TableResultRow = {
  type?: string;
  name?: string;
  text?: string;
  range?: [number, number];
  documentUuid?: string;
};

export function clampLootRollSum(category: LootCategoryKey, rollSum: number): number {
  if (category === "oddities") {
    return Math.max(3, Math.min(60, rollSum));
  }
  return Math.max(2, Math.min(40, rollSum));
}

export function collectTableResultRows(table: unknown): TableResultRow[] {
  const results = (table as { results?: unknown }).results;
  if (!results) return [];
  if (Array.isArray(results)) return results as TableResultRow[];
  if (typeof results === "object" && results !== null) {
    const contents = (results as { contents?: TableResultRow[] }).contents;
    if (Array.isArray(contents)) return contents;
    const mapFn = (results as { map?: (fn: (r: TableResultRow) => TableResultRow) => TableResultRow[] })
      .map;
    if (typeof mapFn === "function") {
      return mapFn.call(results, (r: TableResultRow) => r);
    }
  }
  return [];
}

export function resultMatchesRollSum(row: TableResultRow, rollSum: number): boolean {
  const range = row.range;
  if (!range || range.length < 2) return false;
  const min = Math.min(range[0]!, range[1]!);
  const max = Math.max(range[0]!, range[1]!);
  return rollSum >= min && rollSum <= max;
}

function labelFromResultRow(
  row: TableResultRow,
  tableKey: ScavengingRollTableKey | null,
): string {
  const name = row.name?.trim();
  if (name) return name;
  const text = row.text?.trim();
  if (text) return text;
  return tableKey ? getRollTableDisplayName(tableKey) : "—";
}

const documentNameCache = new Map<string, string>();

async function labelForResultRow(
  row: TableResultRow,
  tableKey: ScavengingRollTableKey | null,
): Promise<string> {
  const uuid = row.documentUuid?.trim();
  if (uuid) {
    const cached = documentNameCache.get(uuid);
    if (cached) return cached;
    try {
      const doc = await fromUuid(uuid);
      const name =
        doc && typeof doc === "object" && "name" in doc
          ? String((doc as { name?: string }).name ?? "").trim()
          : "";
      if (name) {
        documentNameCache.set(uuid, name);
        return name;
      }
    } catch {
      /* use fallbacks below */
    }
  }
  return labelFromResultRow(row, tableKey);
}

export async function loadRollTableResultRows(
  category: LootCategoryKey,
): Promise<TableResultRow[] | null> {
  if (category === "junk") return null;
  const found = await findRollTableForCategory(category);
  if (!found) return null;
  const table = await resolveRollTableDocument(found.ref);
  if (!table) return null;
  return collectTableResultRows(table);
}

export async function lookupLootAtRollSum(
  category: LootCategoryKey,
  rollSum: number,
  rows?: TableResultRow[] | null,
): Promise<{ label: string; rollSum: number; itemUuid?: string }> {
  const sum = clampLootRollSum(category, rollSum);

  if (category === "junk") {
    return { label: `${sum} junk items`, rollSum: sum, itemUuid: undefined };
  }

  const tableRows = rows ?? (await loadRollTableResultRows(category));
  const tableKey = resolveRollTableKey(category);

  if (!tableRows?.length) {
    const displayName = tableKey
      ? getRollTableDisplayName(tableKey)
      : category;
    return {
      label: `(Roll Table "${displayName}" not found in world)`,
      rollSum: sum,
      itemUuid: undefined,
    };
  }

  const match = tableRows.find((row) => resultMatchesRollSum(row, sum));
  if (!match) {
    return { label: `(No table row for ${sum})`, rollSum: sum, itemUuid: undefined };
  }

  return {
    label: await labelForResultRow(match, tableKey),
    rollSum: sum,
    itemUuid: itemUuidFromTableRow(match),
  };
}

export type LuckNeighborRow = {
  rollSum: number;
  label: string;
  itemUuid?: string;
  /** Shift from the natural roll (base). */
  luckDelta: number;
  /** Total luck from base to reach this row (|luckDelta|). */
  luckCostFromBase: number;
  /** Additional luck to jump here from the entry's current shift. */
  jumpCost: number;
  luckPrefix: string;
  isCurrent: boolean;
};

export function entryBaseRollSum(entry: {
  baseRollSum?: number;
  rollSum: number;
  luckShift: number;
}): number {
  if (typeof entry.baseRollSum === "number" && entry.baseRollSum > 0) {
    return entry.baseRollSum;
  }
  return entry.rollSum - entry.luckShift;
}

export async function buildLuckNeighborRows(
  entry: {
    category: LootCategoryKey;
    resolvedTableCategory?: LootCategoryKey;
    baseRollSum?: number;
    rollSum: number;
    luckShift: number;
  },
  location: ScavengerLocation,
  formatLuckSpend: (jumpCost: number) => string,
): Promise<LuckNeighborRow[]> {
  if (entry.category === "junk" || entry.rollSum <= 0) return [];

  const rollCategory = entry.resolvedTableCategory ?? entry.category;
  const base = entryBaseRollSum(entry);
  const level = Math.max(0, Math.floor(location.level));

  const sceneTable = findSceneRollTableForCategory(location, rollCategory);
  const rows = sceneTable
    ? collectTableResultRows(sceneTable)
    : ((await loadRollTableResultRows(rollCategory)) ?? []);

  const out: LuckNeighborRow[] = [];

  for (let delta = -level; delta <= level; delta += 1) {
    const luckCostFromBase = Math.abs(delta);
    const isCurrent = delta === entry.luckShift;
    const jumpCost = Math.abs(delta - entry.luckShift);

    const rollSum = clampLootRollSum(rollCategory, base + delta);
    const looked = await lookupLootAtRollSum(rollCategory, rollSum, rows);

    out.push({
      rollSum,
      label: looked.label,
      itemUuid: looked.itemUuid,
      luckDelta: delta,
      luckCostFromBase,
      jumpCost,
      luckPrefix:
        isCurrent || jumpCost <= 0 ? "" : formatLuckSpend(jumpCost),
      isCurrent,
    });
  }

  return out;
}

/** Clear cached compendium item names between renders. */
export function clearRollTableLookupCache(): void {
  documentNameCache.clear();
}
