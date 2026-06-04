import rollTableNames from "../data/scavenging/roll-table-names.json";
import type { ItemCategoryRange, LootCategoryKey } from "./ScavengerLocation.js";

/** Keys that map to a Foundry RollTable (not `weapons` or `junk`). */
export type ScavengingRollTableKey = Exclude<
  LootCategoryKey,
  "weapons" | "junk"
>;

/** No Foundry RollTable (junk uses 2d20 quantity; weapons resolve to a sub-table). */
export const LOOT_WITHOUT_ROLL_TABLE: ReadonlySet<LootCategoryKey> = new Set([
  "junk",
]);

type TableNameEntry = { names: string[] };

const TABLE_NAMES = rollTableNames.tables as Record<
  ScavengingRollTableKey,
  TableNameEntry
>;

/** All loot tables from the GM Screen booklet (for status UI). */
export const SCAVENGING_ROLL_TABLE_KEYS: ScavengingRollTableKey[] = [
  "ammunition",
  "armor",
  "clothing",
  "food",
  "beverages",
  "chems",
  "oddities",
  "weaponsRanged",
  "weaponsMelee",
  "weaponsThrown",
  "otherFoundItems",
];

export function getRollTableDisplayName(key: ScavengingRollTableKey): string {
  return TABLE_NAMES[key]?.names[0] ?? key;
}

export function getRollTableNameCandidates(key: ScavengingRollTableKey): string[] {
  return TABLE_NAMES[key]?.names ?? [key];
}

/** Resolve abstract `weapons` to a concrete weapon loot table. */
export function resolveWeaponSubcategory(): LootCategoryKey {
  const options: LootCategoryKey[] = [
    "weaponsRanged",
    "weaponsMelee",
    "weaponsThrown",
  ];
  return options[Math.floor(Math.random() * options.length)]!;
}

export function categoryUsesRollTable(category: LootCategoryKey): boolean {
  return !LOOT_WITHOUT_ROLL_TABLE.has(category);
}

export function resolveRollTableKey(
  category: LootCategoryKey,
): ScavengingRollTableKey | null {
  if (!categoryUsesRollTable(category)) return null;
  if (category === "weapons") {
    return resolveWeaponSubcategory();
  }
  if (category in TABLE_NAMES) {
    return category as ScavengingRollTableKey;
  }
  return null;
}

function getGameTables(): Array<{ id: string; name: string; results?: { size: number } }> {
  const tables = (game as { tables?: { contents?: Array<{ id: string; name: string; results?: { size: number } }> } })
    .tables?.contents;
  return tables ?? [];
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function findRollTableByKey(
  key: ScavengingRollTableKey,
): { id: string; name: string } | undefined {
  const candidates = getRollTableNameCandidates(key).map(normalizeName);
  const tables = getGameTables();
  for (const table of tables) {
    if (candidates.includes(normalizeName(table.name))) {
      return table;
    }
  }
  return undefined;
}

export function findRollTableForCategory(
  category: LootCategoryKey,
): { id: string; name: string; tableKey: ScavengingRollTableKey } | undefined {
  const tableKey = resolveRollTableKey(category);
  if (!tableKey) return undefined;
  const found = findRollTableByKey(tableKey);
  if (!found) return undefined;
  return { ...found, tableKey };
}

function getTableDocument(
  tableId: string,
): {
  results?: { size: number };
  sheet?: { render: (force?: boolean) => Promise<unknown> };
} | undefined {
  const doc = (game as { tables?: { get?: (id: string) => unknown } }).tables?.get?.(
    tableId,
  );
  return doc as ReturnType<typeof getTableDocument>;
}

function tableHasResults(doc: NonNullable<ReturnType<typeof getTableDocument>>): boolean {
  return (doc.results?.size ?? 0) > 0;
}

export type ScavengingRollTableStatusRow = {
  tableKey: ScavengingRollTableKey;
  name: string;
  installed: boolean;
  tableId?: string;
  resultCount: number;
};

export function getScavengingRollTableStatus(keys?: ScavengingRollTableKey[]): {
  tables: ScavengingRollTableStatusRow[];
  allInstalled: boolean;
} {
  const list = keys ?? SCAVENGING_ROLL_TABLE_KEYS;
  const tables: ScavengingRollTableStatusRow[] = list.map((tableKey) => {
    const name = getRollTableDisplayName(tableKey);
    const found = findRollTableByKey(tableKey);
    if (!found) {
      return {
        tableKey,
        name,
        installed: false,
        resultCount: 0,
      };
    }
    const doc = getTableDocument(found.id);
    const resultCount = doc?.results?.size ?? 0;
    const installed = Boolean(doc && tableHasResults(doc));
    return {
      tableKey,
      name,
      installed,
      tableId: found.id,
      resultCount,
    };
  });

  return {
    tables,
    allInstalled: tables.every((t) => t.installed),
  };
}

/** Roll tables relevant to a generated location's loot categories. */
export function getRollTableKeysForLocation(
  items: ItemCategoryRange[],
): ScavengingRollTableKey[] {
  const keys = new Set<ScavengingRollTableKey>();
  for (const row of items) {
    if (row.max <= 0 && row.min <= 0) continue;
    if (row.category === "weapons") {
      keys.add("weaponsRanged");
      keys.add("weaponsMelee");
      keys.add("weaponsThrown");
      continue;
    }
    if (!categoryUsesRollTable(row.category)) continue;
    const resolved = resolveRollTableKey(row.category);
    if (resolved) keys.add(resolved);
  }
  return [...keys].sort((a, b) =>
    getRollTableDisplayName(a).localeCompare(getRollTableDisplayName(b)),
  );
}

export function openScavengingRollTable(tableId: string): void {
  const doc = getTableDocument(tableId);
  if (!doc) return;
  if (doc.sheet?.render) {
    void doc.sheet.render(true);
    return;
  }
  ui.notifications.warn(
    (game.i18n as { localize: (k: string) => string }).localize(
      "WASTELANDER.Scavenging.Tables.OpenFailed",
    ),
  );
}
