import { getRollTableDocument } from "../integrations/rollTableDocuments.js";
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
  description?: string;
  range?: [number, number];
  documentUuid?: string;
};

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, "").trim();
}

export function labelFromTableResultRow(row: TableResultRow): string {
  const name = row.name?.trim();
  if (name) return name;
  const text = row.text?.trim();
  if (text) return text;
  const description = row.description?.trim();
  if (description) return stripHtml(description);
  return "";
}

function extractRollTotal(source: Record<string, unknown>): number | undefined {
  const rollTotal = source.rollTotal;
  if (typeof rollTotal === "number" && Number.isFinite(rollTotal)) {
    return rollTotal;
  }
  const roll = source.roll;
  if (roll && typeof roll === "object") {
    const total = (roll as { total?: number | null }).total;
    if (typeof total === "number" && Number.isFinite(total)) return total;
  }
  const rolls = source.rolls;
  if (Array.isArray(rolls)) {
    for (const entry of rolls) {
      if (!entry || typeof entry !== "object") continue;
      const total = (entry as { total?: number | null }).total;
      if (typeof total === "number" && Number.isFinite(total)) return total;
    }
  }
  return undefined;
}

export function clampLootRollSum(category: LootCategoryKey, rollSum: number): number {
  if (category === "oddities") {
    return Math.max(3, Math.min(60, rollSum));
  }
  return Math.max(2, Math.min(40, rollSum));
}

function parseResultRange(rangeRaw: unknown): [number, number] | undefined {
  if (!Array.isArray(rangeRaw) || rangeRaw.length < 2) return undefined;
  const low = Number(rangeRaw[0]);
  const high = Number(rangeRaw[1]);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return undefined;
  return [low, high];
}

function objectAsTableResultRow(entry: unknown): TableResultRow | null {
  if (!entry || typeof entry !== "object") return null;
  const row = entry as Record<string, unknown> & {
    toObject?: () => unknown;
    toJSON?: () => unknown;
    name?: string;
    text?: string;
    description?: string;
    type?: string;
    range?: unknown;
    documentUuid?: string;
  };

  if (row.tableResult) return objectAsTableResultRow(row.tableResult);
  if (row.result) return objectAsTableResultRow(row.result);

  const range = parseResultRange(row.range);
  let name = typeof row.name === "string" ? row.name : undefined;
  const text = typeof row.text === "string" ? row.text : undefined;
  const description =
    typeof row.description === "string" ? row.description : undefined;
  if (!name?.trim() && description) {
    const plain = stripHtml(description);
    if (plain) name = plain;
  }

  const direct: TableResultRow = {
    type: typeof row.type === "string" ? row.type : undefined,
    name,
    text,
    description,
    range,
    documentUuid:
      typeof row.documentUuid === "string" ? row.documentUuid : undefined,
  };
  if (labelFromTableResultRow(direct) || direct.range || direct.documentUuid) {
    return direct;
  }

  if (typeof row.toObject === "function") {
    return objectAsTableResultRow(row.toObject());
  }
  if (typeof row.toJSON === "function") {
    return objectAsTableResultRow(row.toJSON());
  }

  return direct.range || direct.documentUuid ? direct : null;
}

/** Parse Foundry `RollTable#draw()` output (v13 collections or plain arrays). */
export function collectDrawResults(raw: unknown): {
  results: TableResultRow[];
  rollTotal?: number;
} {
  if (!raw || typeof raw !== "object") return { results: [] };
  const obj = raw as Record<string, unknown>;
  const buckets: Record<string, unknown>[] = [obj];
  if (obj.RollTableDraw && typeof obj.RollTableDraw === "object") {
    buckets.push(obj.RollTableDraw as Record<string, unknown>);
  }

  let rollTotal: number | undefined;
  const results: TableResultRow[] = [];
  const seen = new Set<string>();

  const push = (entry: unknown) => {
    const row = objectAsTableResultRow(entry);
    if (!row) return;
    const key = `${row.range?.join("-") ?? ""}:${labelFromTableResultRow(row)}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push(row);
  };

  for (const inner of buckets) {
    if (rollTotal == null) rollTotal = extractRollTotal(inner);

    for (const key of ["results", "drawnResults", "drawn"] as const) {
      const bucket = inner[key];
      if (!bucket) continue;
      if (Array.isArray(bucket)) {
        for (const entry of bucket) push(entry);
      } else {
        for (const entry of collectTableResultRows({ results: bucket })) {
          results.push(entry);
        }
      }
    }
  }

  return { results, rollTotal };
}

function drawBuckets(raw: unknown): Record<string, unknown>[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  const buckets = [obj];
  if (obj.RollTableDraw && typeof obj.RollTableDraw === "object") {
    buckets.push(obj.RollTableDraw as Record<string, unknown>);
  }
  return buckets;
}

function extractRollFromDraw(raw: unknown): Roll | undefined {
  for (const inner of drawBuckets(raw)) {
    const roll = inner.roll;
    if (roll && typeof roll === "object") {
      const total = (roll as { total?: number | null }).total;
      if (typeof total === "number" && Number.isFinite(total)) {
        return roll as Roll;
      }
    }
  }
  return undefined;
}

function extractRollTotalFromDraw(raw: unknown): number | undefined {
  const fromCollect = collectDrawResults(raw).rollTotal;
  if (fromCollect != null) return fromCollect;
  const roll = extractRollFromDraw(raw);
  if (roll?.total != null && Number.isFinite(roll.total)) return roll.total;
  for (const inner of drawBuckets(raw)) {
    const total = extractRollTotal(inner);
    if (total != null) return total;
  }
  return undefined;
}

function labelsFromResultRows(rows: TableResultRow[]): string {
  return rows
    .map((row) => labelFromTableResultRow(row))
    .filter(Boolean)
    .join(", ");
}

function lookupRowsForRoll(
  table: RollTable,
  rollArg: Roll | number,
): TableResultRow[] {
  const rollTotal =
    typeof rollArg === "number"
      ? rollArg
      : rollArg.total != null && Number.isFinite(rollArg.total)
        ? rollArg.total
        : undefined;
  if (rollTotal == null) return [];

  const getResultsForRoll = (
    table as { getResultsForRoll?: (value: number) => unknown }
  ).getResultsForRoll;
  if (typeof getResultsForRoll !== "function") return [];
  try {
    return collectTableResultRows({
      results: getResultsForRoll.call(table, rollTotal),
    });
  } catch {
    return [];
  }
}

/** Resolve a drawn label from draw output and/or the table document. */
export function resolveRollTableDrawLabel(
  table: RollTable,
  raw: unknown,
): { label: string; rollTotal?: number; rows: TableResultRow[] } | null {
  const doc = getRollTableDocument(table.id) ?? table;
  const { results } = collectDrawResults(raw);
  const roll = extractRollFromDraw(raw);
  const rollTotal = extractRollTotalFromDraw(raw);

  const fromDraw = labelsFromResultRows(results);
  if (fromDraw) {
    return { label: fromDraw, rollTotal: rollTotal ?? roll?.total ?? undefined, rows: results };
  }

  const rollArgs: Array<Roll | number> = [];
  if (roll) rollArgs.push(roll);
  if (rollTotal != null) rollArgs.push(rollTotal);

  for (const rollArg of rollArgs) {
    const hitRows = lookupRowsForRoll(doc, rollArg);
    const fromHits = labelsFromResultRows(hitRows);
    if (fromHits) {
      const total =
        rollTotal ??
        roll?.total ??
        (typeof rollArg === "number" ? rollArg : rollArg.total ?? undefined);
      return { label: fromHits, rollTotal: total ?? undefined, rows: hitRows };
    }
  }

  if (rollTotal != null) {
    const tableRows = collectTableResultRows(doc);
    const match = tableRows.find((row) => resultMatchesRollSum(row, rollTotal));
    if (match) {
      const label = labelFromTableResultRow(match);
      if (label) return { label, rollTotal, rows: [match] };
    }
  }

  return null;
}

export type RollTableDrawOutcome = {
  label: string;
  rollTotal: number;
  drewToChat: boolean;
  rows: TableResultRow[];
};

type RollTableDrawOptions = {
  displayChat?: boolean;
  maxAttempts?: number;
  drawOptions?: Record<string, unknown>;
};

/** Shared RollTable draw used by scavenging loot and NPC oracle tables. */
export async function executeRollTableDraw(
  table: RollTable,
  options?: RollTableDrawOptions,
): Promise<RollTableDrawOutcome> {
  const displayChat = options?.displayChat ?? true;
  const maxAttempts = Math.max(1, options?.maxAttempts ?? 1);
  const doc = getRollTableDocument(table.id) ?? table;
  const extraDrawOptions = options?.drawOptions ?? {};

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const raw = await doc.draw({
      ...extraDrawOptions,
      displayChat: displayChat && attempt === 0,
    });
    const resolved = resolveRollTableDrawLabel(doc, raw);
    if (resolved?.label) {
      return {
        label: resolved.label,
        rollTotal: resolved.rollTotal ?? 0,
        drewToChat: displayChat && attempt === 0,
        rows: resolved.rows,
      };
    }
  }

  return {
    label: `(No result on ${doc.name})`,
    rollTotal: 0,
    drewToChat: displayChat,
    rows: [],
  };
}

export function collectTableResultRows(table: unknown): TableResultRow[] {
  const results = (table as { results?: unknown }).results;
  if (!results) return [];
  if (Array.isArray(results)) {
    return results
      .map((entry) => objectAsTableResultRow(entry))
      .filter((row): row is TableResultRow => row != null);
  }
  if (typeof results === "object" && results !== null) {
    const contents = (results as { contents?: unknown[] }).contents;
    if (Array.isArray(contents)) {
      return contents
        .map((entry) => objectAsTableResultRow(entry))
        .filter((row): row is TableResultRow => row != null);
    }
    const mapFn = (
      results as { map?: (fn: (r: unknown) => TableResultRow | null) => TableResultRow[] }
    ).map;
    if (typeof mapFn === "function") {
      return mapFn
        .call(results, (entry: unknown) => objectAsTableResultRow(entry))
        .filter((row: TableResultRow | null): row is TableResultRow => row != null);
    }
    if (Symbol.iterator in results) {
      const rows: TableResultRow[] = [];
      for (const entry of results as Iterable<unknown>) {
        const row = objectAsTableResultRow(entry);
        if (row) rows.push(row);
      }
      return rows;
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
