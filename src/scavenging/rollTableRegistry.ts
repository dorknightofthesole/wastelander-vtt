import { WASTELANDER_ROLL_TABLES_PACK } from "../constants.js";
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

const FALLOUT_SYSTEM_ID = "fallout";
const FALLOUT_ROLLABLE_TABLES_PACK = "fallout.rollable_tables";

/** Fallout scavenging settings use slightly different category keys. */
const FALLOUT_SCAVENGING_CATEGORY_KEY: Partial<
  Record<ScavengingRollTableKey, string>
> = {
  otherFoundItems: "other",
};

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

export type RollTableRef = {
  /** World document id or compendium UUID. */
  ref: string;
  name: string;
};

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

type RollTableSummary = { id: string; name: string; results?: { size: number } };

function getGameTables(): RollTableSummary[] {
  const out: RollTableSummary[] = [];
  const tables = (
    game as {
      tables?: {
        contents?: RollTableSummary[];
        forEach?: (fn: (t: RollTableSummary) => void) => void;
        values?: () => IterableIterator<RollTableSummary>;
      };
    }
  ).tables;

  if (tables?.contents?.length) return tables.contents;

  if (tables?.forEach) {
    tables.forEach((t) => out.push(t));
    if (out.length) return out;
  }

  if (tables?.values) {
    return [...tables.values()];
  }

  const collection = (
    game as { collections?: { get?: (name: string) => { contents?: RollTableSummary[] } } }
  ).collections?.get?.("RollTable");
  return collection?.contents ?? [];
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function falloutCategorySettingKey(key: ScavengingRollTableKey): string {
  if (key.startsWith("weapons")) return "weapons";
  return FALLOUT_SCAVENGING_CATEGORY_KEY[key] ?? key;
}

function getFalloutScavengingTableUuid(key: ScavengingRollTableKey): string | undefined {
  if (game.system?.id !== FALLOUT_SYSTEM_ID) return undefined;
  const tables = game.settings.get(FALLOUT_SYSTEM_ID, "scavengingCategoryTables") as
    | Record<string, string>
    | undefined;
  const uuid = tables?.[falloutCategorySettingKey(key)]?.trim();
  return uuid || undefined;
}

function findWorldRollTableByKey(
  key: ScavengingRollTableKey,
): RollTableRef | undefined {
  const candidates = new Set(getRollTableNameCandidates(key).map(normalizeName));
  for (const table of getGameTables()) {
    if (candidates.has(normalizeName(table.name))) {
      return { ref: table.id, name: table.name };
    }
  }
  return undefined;
}

/** Sync lookup: world tables by name, then Fallout scavenging table UUIDs. */
export function findRollTableByKey(
  key: ScavengingRollTableKey,
): RollTableRef | undefined {
  const world = findWorldRollTableByKey(key);
  if (world) return world;

  const falloutUuid = getFalloutScavengingTableUuid(key);
  if (falloutUuid) {
    return { ref: falloutUuid, name: getRollTableDisplayName(key) };
  }

  return undefined;
}

async function findCompendiumRollTableByKey(
  key: ScavengingRollTableKey,
): Promise<RollTableRef | undefined> {
  const candidates = new Set(getRollTableNameCandidates(key).map(normalizeName));
  const packIds: string[] = [WASTELANDER_ROLL_TABLES_PACK];

  if (game.system?.id === FALLOUT_SYSTEM_ID) {
    const scavPack = game.settings.get(FALLOUT_SYSTEM_ID, "scavengingCompendium") as string;
    if (scavPack?.trim()) packIds.push(scavPack.trim());
    packIds.push(FALLOUT_ROLLABLE_TABLES_PACK);
  }

  for (const pack of (game as { packs?: Iterable<{ metadata: { id: string; type: string } }> })
    .packs ?? []) {
    if (pack.metadata.type !== "RollTable") continue;
    if (!packIds.includes(pack.metadata.id)) {
      packIds.push(pack.metadata.id);
    }
  }

  for (const packId of packIds) {
    const pack = (game as { packs?: { get?: (id: string) => CompendiumPackLike } }).packs?.get?.(
      packId,
    );
    if (!pack) continue;

    const index = await pack.getIndex({ fields: ["name", "uuid"] });
    for (const entry of index) {
      const name = String((entry as { name?: string }).name ?? "");
      if (!candidates.has(normalizeName(name))) continue;
      const uuid = String((entry as { uuid?: string }).uuid ?? "");
      if (!uuid) continue;
      return { ref: uuid, name };
    }
  }

  return undefined;
}

export async function findRollTableRefByKey(
  key: ScavengingRollTableKey,
): Promise<RollTableRef | undefined> {
  return findRollTableByKey(key) ?? findCompendiumRollTableByKey(key);
}

export async function findRollTableForCategory(
  category: LootCategoryKey,
): Promise<(RollTableRef & { tableKey: ScavengingRollTableKey }) | undefined> {
  const tableKey = resolveRollTableKey(category);
  if (!tableKey) return undefined;
  const found = await findRollTableRefByKey(tableKey);
  if (!found) return undefined;
  return { ...found, tableKey };
}

export type RollTableDocument = {
  results?: { size: number };
  sheet?: { render: (force?: boolean) => Promise<unknown> };
  draw?: (options?: Record<string, unknown>) => Promise<unknown>;
};

type CompendiumPackLike = {
  getIndex: (options?: { fields?: string[] }) => Promise<
    Array<{ name?: string; uuid?: string }>
  >;
};

export function getRollTableDocument(tableId: string): RollTableDocument | undefined {
  const tables = (game as { tables?: { get?: (id: string) => unknown } }).tables;
  const fromTables = tables?.get?.(tableId);
  if (fromTables) return fromTables as RollTableDocument;

  const collection = (
    game as { collections?: { get?: (name: string) => { get?: (id: string) => unknown } } }
  ).collections?.get?.("RollTable");
  const fromCollection = collection?.get?.(tableId);
  return fromCollection ? (fromCollection as RollTableDocument) : undefined;
}

/** Resolve a world id or compendium UUID to a roll table document. */
export async function resolveRollTableDocument(
  tableRef: string,
): Promise<RollTableDocument | undefined> {
  if (tableRef.startsWith("Compendium.")) {
    const doc = await fromUuid(tableRef);
    return doc ? (doc as RollTableDocument) : undefined;
  }
  return getRollTableDocument(tableRef);
}

function tableHasResults(doc: RollTableDocument): boolean {
  return (doc.results?.size ?? 0) > 0;
}

export type ScavengingRollTableStatusRow = {
  tableKey: ScavengingRollTableKey;
  name: string;
  installed: boolean;
  tableId?: string;
  resultCount: number;
};

export async function getScavengingRollTableStatus(
  keys?: ScavengingRollTableKey[],
): Promise<{
  tables: ScavengingRollTableStatusRow[];
  allInstalled: boolean;
}> {
  const list = keys ?? SCAVENGING_ROLL_TABLE_KEYS;
  const tables: ScavengingRollTableStatusRow[] = [];

  for (const tableKey of list) {
    const name = getRollTableDisplayName(tableKey);
    const found = await findRollTableRefByKey(tableKey);
    if (!found) {
      tables.push({
        tableKey,
        name,
        installed: false,
        resultCount: 0,
      });
      continue;
    }

    const doc = await resolveRollTableDocument(found.ref);
    const resultCount = doc?.results?.size ?? 0;
    const installed = Boolean(doc && tableHasResults(doc));
    tables.push({
      tableKey,
      name,
      installed,
      tableId: found.ref,
      resultCount,
    });
  }

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

export function openScavengingRollTable(tableRef: string): void {
  void (async () => {
    const doc = await resolveRollTableDocument(tableRef);
    if (!doc) {
      ui.notifications.warn(
        (game.i18n as { localize: (k: string) => string }).localize(
          "WASTELANDER.Scavenging.Tables.OpenFailed",
        ),
      );
      return;
    }
    if (doc.sheet?.render) {
      void doc.sheet.render(true);
      return;
    }
    ui.notifications.warn(
      (game.i18n as { localize: (k: string) => string }).localize(
        "WASTELANDER.Scavenging.Tables.OpenFailed",
      ),
    );
  })();
}
