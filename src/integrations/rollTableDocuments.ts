import { MODULE_ID } from "../constants.js";

const SILENT = { render: false } as const;
export const ROLL_TABLE_CREATE_OPTIONS = { render: false, keepId: false } as const;

/** LIMITED — players can draw on scene loot tables without seeing the sidebar folder. */
const SCENE_LOOT_TABLE_OWNERSHIP = { default: 1 } as const;

const RESULT_STRIP_KEYS = new Set([
  "_stats",
  "drawn",
  "documentUuid",
  "flags",
  "uuid",
]);

function deepClone<T>(value: T): T {
  return (foundry.utils as { deepClone: <U>(v: U) => U }).deepClone(value);
}

function folderParentId(folder: Folder): string | null {
  const parent = (folder as { folder?: string | Folder | null }).folder;
  if (parent == null || parent === "") return null;
  if (typeof parent === "string") return parent;
  if (typeof parent === "object" && "id" in parent) {
    return String((parent as { id: string }).id);
  }
  return null;
}

function folderCacheKey(name: string, parentId: string | null): string {
  return `${parentId ?? ""}\0${name}`;
}

const folderIdCache = new Map<string, string>();

export function clearRollTableFolderCache(): void {
  folderIdCache.clear();
}

function listRollTableFolders(): Folder[] {
  const folders = (game as { folders?: Iterable<Folder> }).folders;
  if (!folders) return [];
  return Array.from(folders).filter((folder) => folder.type === "RollTable");
}

export function findRollTableFolder(
  name: string,
  parentId: string | null,
): Folder | undefined {
  const targetParent = parentId ?? null;
  for (const folder of listRollTableFolders()) {
    if (folder.name !== name) continue;
    if (folderParentId(folder) === targetParent) return folder;
  }
  return undefined;
}

export async function ensureRollTableFolder(
  name: string,
  parentId: string | null,
): Promise<string | undefined> {
  const cacheKey = folderCacheKey(name, parentId);
  const cached = folderIdCache.get(cacheKey);
  if (cached) return cached;

  const existing = findRollTableFolder(name, parentId);
  if (existing) {
    folderIdCache.set(cacheKey, existing.id);
    return existing.id;
  }

  const created = await Folder.implementation.createDocuments(
    [{ name, type: "RollTable", folder: parentId }],
    ROLL_TABLE_CREATE_OPTIONS,
  );
  const folder = created[0];
  if (!folder) return undefined;

  folderIdCache.set(cacheKey, folder.id);
  return folder.id;
}

/** Ensure nested RollTable folders; returns the deepest folder id. */
export async function ensureRollTableFolderTree(
  segments: string[],
): Promise<string | undefined> {
  let parentId: string | null = null;
  for (const segment of segments) {
    const name = segment.trim();
    if (!name) continue;
    const id = await ensureRollTableFolder(name, parentId);
    if (!id) return undefined;
    parentId = id;
  }
  return parentId ?? undefined;
}

export type RollTableSummary = {
  id: string;
  name: string;
  folder?: string | Folder | null;
};

type RollTableResultsLike =
  | Array<{ id?: string }>
  | {
      size?: number;
      length?: number;
      contents?: Array<{ id?: string }>;
      map?: (fn: (row: { id?: string }) => string) => string[];
    }
  | null
  | undefined;

/** Foundry v13 embedded collections expose `.size`; older paths may use arrays. */
export function rollTableResultCount(doc: { results?: RollTableResultsLike }): number {
  const results = doc.results;
  if (!results) return 0;
  if (
    typeof results === "object" &&
    !Array.isArray(results) &&
    typeof results.size === "number"
  ) {
    return results.size;
  }
  if (Array.isArray(results)) return results.length;
  if (
    typeof results === "object" &&
    Array.isArray(results.contents)
  ) {
    return results.contents.length;
  }
  if (
    typeof results === "object" &&
    typeof results.length === "number"
  ) {
    return results.length;
  }
  if (typeof results === "object" && Symbol.iterator in results) {
    let count = 0;
    for (const _row of results as Iterable<unknown>) {
      count += 1;
    }
    return count;
  }
  return 0;
}

export function rollTableResultIds(doc: { results?: RollTableResultsLike }): string[] {
  const results = doc.results;
  if (!results) return [];
  if (Array.isArray(results)) {
    return results.map((row) => String(row.id ?? "")).filter(Boolean);
  }
  if (typeof results === "object") {
    if (typeof results.map === "function") {
      return results.map((row) => String(row.id ?? "")).filter(Boolean);
    }
    if (Array.isArray(results.contents)) {
      return results.contents
        .map((row) => String(row.id ?? ""))
        .filter(Boolean);
    }
  }
  return [];
}

export function formatRollTableFolderPath(
  doc: { folder?: string | Folder | null },
): string {
  const folders = (game as { folders?: { get?: (id: string) => Folder } }).folders;
  const parts: string[] = [];
  const seen = new Set<string>();
  let folderId = documentFolderId(doc);

  while (folderId && !seen.has(folderId)) {
    seen.add(folderId);
    const folder = folders?.get?.(folderId);
    if (!folder) break;
    parts.unshift(folder.name);
    folderId = folderParentId(folder);
  }

  return parts.length ? parts.join(" → ") : "(Roll Tables root)";
}

export function documentFolderId(
  doc: { folder?: string | Folder | null },
): string | null {
  const folder = doc.folder;
  if (folder == null || folder === "") return null;
  if (typeof folder === "string") return folder;
  if (typeof folder === "object" && "id" in folder) {
    return String((folder as { id: string }).id);
  }
  return null;
}

export function listWorldRollTableSummaries(): RollTableSummary[] {
  const out: RollTableSummary[] = [];
  const tables = (game as { tables?: { contents?: RollTableSummary[] } }).tables;
  if (tables?.contents?.length) {
    out.push(...tables.contents);
  }

  const collection = (
    game as { collections?: { get?: (name: string) => { contents?: RollTableSummary[] } } }
  ).collections?.get?.("RollTable");
  if (collection?.contents?.length) {
    for (const table of collection.contents) {
      if (!out.some((row) => row.id === table.id)) out.push(table);
    }
  }

  return out;
}

export function normalizeTableName(name: string): string {
  return name.trim().toLowerCase();
}

export function getRollTableDocument(tableId: string): RollTable | undefined {
  const fromTables = (game as { tables?: { get?: (id: string) => RollTable } }).tables?.get?.(
    tableId,
  );
  if (fromTables) return fromTables;

  const fromCollection = (
    game as { collections?: { get?: (name: string) => { get?: (id: string) => RollTable } } }
  ).collections?.get?.("RollTable")?.get?.(tableId);
  return fromCollection ?? undefined;
}

export function findWorldRollTableByName(
  name: string,
  folderId?: string,
  options?: { folderOnly?: boolean },
): RollTable | undefined {
  const target = normalizeTableName(name);
  const summaries = listWorldRollTableSummaries();
  const folderOnly = options?.folderOnly === true;

  if (folderId) {
    for (const row of summaries) {
      if (normalizeTableName(row.name) !== target) continue;
      const doc = getRollTableDocument(row.id);
      if (doc && documentFolderId(doc) === folderId) return doc;
    }
    if (folderOnly) return undefined;
  }

  const anywhere = summaries.find((row) => normalizeTableName(row.name) === target);
  return anywhere ? getRollTableDocument(anywhere.id) : undefined;
}

export function findRollTableFolderByFlag(
  parentId: string | null,
  flagNamespace: string,
  flagKey: string,
  flagValue: string,
): Folder | undefined {
  for (const folder of listRollTableFolders()) {
    if (folderParentId(folder) !== parentId) continue;
    const flags = (folder.flags as Record<string, Record<string, unknown>>)?.[
      flagNamespace
    ];
    if (flags?.[flagKey] === flagValue) return folder;
  }
  return undefined;
}

export function listRollTablesInFolder(folderId: string): RollTable[] {
  const tables: RollTable[] = [];
  for (const summary of listWorldRollTableSummaries()) {
    const doc = getRollTableDocument(summary.id);
    if (!doc) continue;
    if (documentFolderId(doc) === folderId) tables.push(doc);
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteRollTablesInFolder(folderId: string): Promise<void> {
  const tables = listRollTablesInFolder(folderId);
  if (!tables.length) return;
  await RollTable.implementation.deleteDocuments(
    tables.map((table) => table.id),
    ROLL_TABLE_CREATE_OPTIONS,
  );
}

export type RollTableResultPayload = {
  type: string;
  name: string;
  range: [number, number];
  weight?: number;
  documentUuid?: string | null;
  img?: string;
  description?: string;
};

export type UpsertRollTableParams = {
  name: string;
  folderId: string;
  formula: string;
  results: RollTableResultPayload[];
  flags?: Record<string, unknown>;
  description?: string;
  /** When true, only match/update a table already in `folderId` (never move compendium copies). */
  folderOnly?: boolean;
};

function prepareEmbeddedResults(
  results: RollTableResultPayload[],
): Record<string, unknown>[] {
  return results.map((raw) => {
    const row: Record<string, unknown> = {
      type: raw.type,
      name: raw.name,
      range: raw.range,
      weight: raw.weight ?? 1,
      img: raw.img ?? "icons/svg/d20-black.svg",
      description: raw.description ?? "",
    };
    if (raw.documentUuid) row.documentUuid = raw.documentUuid;
    return row;
  });
}

export async function upsertRollTableInFolder(
  params: UpsertRollTableParams,
): Promise<RollTable | undefined> {
  const name = params.name.trim();
  if (!name) return undefined;

  const results = prepareEmbeddedResults(params.results);
  const tablePayload: Record<string, unknown> = {
    name,
    folder: params.folderId,
    formula: params.formula,
    replacement: true,
    displayRoll: true,
    description: params.description ?? "",
    flags: params.flags ?? {},
    ownership: SCENE_LOOT_TABLE_OWNERSHIP,
  };

  const existing = findWorldRollTableByName(name, params.folderId, {
    folderOnly: params.folderOnly ?? false,
  });

  try {
    if (existing) {
      await existing.update(tablePayload, SILENT);

      const resultIds = rollTableResultIds(existing);
      if (resultIds.length) {
        await existing.deleteEmbeddedDocuments("TableResult", resultIds, SILENT);
      }
      if (results.length) {
        await existing.createEmbeddedDocuments("TableResult", results, SILENT);
      }

      return getRollTableDocument(existing.id);
    }

    const created = await RollTable.implementation.createDocuments(
      [{ ...tablePayload, results }],
      ROLL_TABLE_CREATE_OPTIONS,
    );
    const table = created[0];
    return table ? getRollTableDocument(table.id) : undefined;
  } catch (err) {
    console.warn(`${MODULE_ID} | failed to upsert roll table "${name}"`, err);
    return undefined;
  }
}
