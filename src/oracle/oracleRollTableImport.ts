import { MODULE_ID } from "../constants.js";
import { t } from "../integrations/i18n.js";
import {
  getBundledOracleRollTables,
  type OracleRollTableJson,
} from "./oracleImportSources.js";
import {
  ORACLE_ROOT_FOLDER,
  ORACLE_SUBFOLDER,
} from "./oracleRollTableFolders.js";

const SILENT = { render: false } as const;
const CREATE_OPTIONS = { render: false, keepId: false } as const;

const TABLE_STRIP_KEYS = new Set([
  "_id",
  "folder",
  "ownership",
  "flags",
  "_stats",
  "uuid",
  "sort",
  "permission",
  "documentName",
  "collection",
  "compendium",
]);

const RESULT_STRIP_KEYS = new Set([
  "_stats",
  "drawn",
  "documentUuid",
  "flags",
  "uuid",
]);

export type OracleRollTableImportResult = {
  created: number;
  updated: number;
  failed: number;
  errors: string[];
};

function deepClone<T>(value: T): T {
  return (foundry.utils as { deepClone: <U>(v: U) => U }).deepClone(value);
}

function folderParentId(folder: Folder): string | null {
  const id = folder.folder;
  return id == null || id === "" ? null : id;
}

function folderCacheKey(name: string, parentId: string | null): string {
  return `${parentId ?? ""}\0${name}`;
}

const folderIdCache = new Map<string, string>();

function listRollTableFolders(): Folder[] {
  const folders = (game as { folders?: Iterable<Folder> }).folders;
  if (!folders) return [];
  return Array.from(folders).filter((folder) => folder.type === "RollTable");
}

function findRollTableFolder(
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

async function ensureRollTableFolder(
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
    CREATE_OPTIONS,
  );
  const folder = created[0];
  if (!folder) return undefined;

  folderIdCache.set(cacheKey, folder.id);
  return folder.id;
}

async function ensureOracleFolderTree(): Promise<string | undefined> {
  folderIdCache.clear();

  const rootId = await ensureRollTableFolder(ORACLE_ROOT_FOLDER, null);
  if (!rootId) return undefined;

  return ensureRollTableFolder(ORACLE_SUBFOLDER, rootId);
}

type RollTableSummary = {
  id: string;
  name: string;
  folder?: string | null;
};

function listWorldRollTables(): RollTableSummary[] {
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

function normalizeTableName(name: string): string {
  return name.trim().toLowerCase();
}

function getRollTableDocument(tableId: string): RollTable | undefined {
  const fromTables = (game as { tables?: { get?: (id: string) => RollTable } }).tables?.get?.(
    tableId,
  );
  if (fromTables) return fromTables;

  const fromCollection = (
    game as { collections?: { get?: (name: string) => { get?: (id: string) => RollTable } } }
  ).collections?.get?.("RollTable")?.get?.(tableId);
  return fromCollection ?? undefined;
}

function findWorldRollTableByName(
  name: string,
  folderId?: string,
): RollTable | undefined {
  const target = normalizeTableName(name);
  const summaries = listWorldRollTables();

  if (folderId) {
    const inFolder = summaries.find(
      (row) =>
        normalizeTableName(row.name) === target && (row.folder ?? null) === folderId,
    );
    if (inFolder) return getRollTableDocument(inFolder.id);
  }

  const anywhere = summaries.find((row) => normalizeTableName(row.name) === target);
  return anywhere ? getRollTableDocument(anywhere.id) : undefined;
}

function prepareEmbeddedResults(results: unknown[]): Record<string, unknown>[] {
  return results
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      const row = deepClone(raw) as Record<string, unknown>;
      for (const key of RESULT_STRIP_KEYS) delete row[key];
      delete row._id;
      const type = row.type;
      const rowName = row.name;
      if (typeof type !== "string" || typeof rowName !== "string") return null;
      return row;
    })
    .filter((row): row is Record<string, unknown> => row != null);
}

function prepareTableUpdatePayload(
  data: OracleRollTableJson,
  folderId: string,
): Record<string, unknown> {
  const clone = deepClone(data) as Record<string, unknown>;
  for (const key of TABLE_STRIP_KEYS) delete clone[key];
  delete clone.results;

  return {
    ...clone,
    name: String(clone.name ?? data.name ?? "").trim(),
    folder: folderId,
  };
}

async function upsertRollTableFromExport(
  data: OracleRollTableJson,
  folderId: string,
): Promise<"created" | "updated" | "failed"> {
  const name = String(data.name ?? "").trim();
  if (!name) return "failed";

  const results = Array.isArray(data.results)
    ? prepareEmbeddedResults(data.results)
    : [];
  const tablePayload = prepareTableUpdatePayload(data, folderId);

  const existing = findWorldRollTableByName(name, folderId);

  try {
    if (existing) {
      await existing.update(tablePayload, SILENT);

      const resultIds = (existing.results ?? []).map((row) => row.id);
      if (resultIds.length) {
        await existing.deleteEmbeddedDocuments("TableResult", resultIds, SILENT);
      }
      if (results.length) {
        await existing.createEmbeddedDocuments("TableResult", results, SILENT);
      }

      return "updated";
    }

    const createPayload = {
      ...tablePayload,
      results,
    };

    const created = await RollTable.implementation.createDocuments(
      [createPayload],
      CREATE_OPTIONS,
    );
    return created[0] ? "created" : "failed";
  } catch (err) {
    console.warn(`${MODULE_ID} | failed to import oracle table "${name}"`, err);
    return "failed";
  }
}

export function getBundledOracleRollTableCount(): number {
  return getBundledOracleRollTables().length;
}

export async function importBundledOracleRollTables(): Promise<OracleRollTableImportResult> {
  const result: OracleRollTableImportResult = {
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  if (game.system.id !== "fallout") {
    result.errors.push(t("WASTELANDER.Oracle.Import.RequiresFallout"));
    return result;
  }

  if (!game.user?.isGM) {
    result.errors.push(t("WASTELANDER.Oracle.Import.GmOnly"));
    return result;
  }

  const bundled = getBundledOracleRollTables();
  if (!bundled.length) {
    result.errors.push(t("WASTELANDER.Oracle.Import.NoBundledFiles"));
    return result;
  }

  const folderId = await ensureOracleFolderTree();
  if (!folderId) {
    result.errors.push(t("WASTELANDER.Oracle.Import.FolderFailed"));
    return result;
  }

  for (const { data } of bundled) {
    const status = await upsertRollTableFromExport(data, folderId);
    if (status === "created") result.created += 1;
    else if (status === "updated") result.updated += 1;
    else {
      result.failed += 1;
      result.errors.push(data.name ?? "(unnamed)");
    }
  }

  return result;
}

export function notifyOracleRollTableImportResult(
  result: OracleRollTableImportResult,
): void {
  if (
    result.errors.length &&
    result.created === 0 &&
    result.updated === 0
  ) {
    ui.notifications.error(
      result.errors[0] ?? t("WASTELANDER.Oracle.Import.Failed"),
    );
    return;
  }

  ui.notifications.info(
    t("WASTELANDER.Oracle.Import.Done", {
      created: result.created,
      updated: result.updated,
      failed: result.failed,
    }),
  );

  if (result.errors.length && (result.failed > 0 || result.created > 0)) {
    console.warn(`${MODULE_ID} | oracle roll table import issues`, result.errors);
  }
}
