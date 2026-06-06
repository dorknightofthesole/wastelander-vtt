import { MODULE_ID } from "../constants.js";
import { ITEM_CREATE_OMIT_KEYS } from "../integrations/fallout.js";
import { t } from "../integrations/i18n.js";
import {
  dedupeDenizenCatalog,
  applyRobotDenizenSystemDefaults,
  favoriteWeaponsInItemList,
  isRobotNpcExport,
  normalizeFalloutBodyType,
  normalizeRobotExportJson,
  parseDenizenFromActorJson,
  resolveImportActorType,
  type FalloutActorJson,
} from "./denizenCatalogParse.js";
import {
  DENIZEN_BOOK_SUBFOLDERS,
  DENIZENS_ROOT_FOLDER,
  resolveDenizenBookFolder,
  type DenizenBookFolder,
} from "./denizenBookFolders.js";
import { getBundledDenizenExports } from "./denizenImportSources.js";

const SILENT = { render: false } as const;
const CREATE_OPTIONS = { render: false, keepId: false } as const;

/** Known invalid / legacy keys on actor exports. */
const ACTOR_CREATE_STRIP_KEYS = new Set([
  "_id",
  "folder",
  "sort",
  "ownership",
  "items",
  "effects",
  "actors",
  "flags",
  "prototypeToken",
  "token",
  "permission",
  "uuid",
  "documentName",
  "collection",
  "compendium",
  "_stats",
]);

export type DenizenImportResult = {
  created: number;
  skipped: number;
  failed: number;
  errors: string[];
};

function deepClone<T>(value: T): T {
  return (foundry.utils as { deepClone: <U>(v: U) => U }).deepClone(value);
}

function prepareEmbeddedItems(items: unknown[]): Record<string, unknown>[] {
  const prepared = items
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      const item = deepClone(raw) as Record<string, unknown>;
      for (const key of ITEM_CREATE_OMIT_KEYS) delete item[key];
      for (const key of ["effects", "_stats", "flags"] as const) delete item[key];
      const type = item.type;
      const name = item.name;
      if (typeof type !== "string" || typeof name !== "string") return null;
      return item;
    })
    .filter((item): item is Record<string, unknown> => item != null);

  return prepared;
}

function prepareActorCreatePayload(
  raw: FalloutActorJson,
  items: Record<string, unknown>[],
): Record<string, unknown> {
  const clone = deepClone(raw) as Record<string, unknown>;
  for (const key of ACTOR_CREATE_STRIP_KEYS) delete clone[key];

  const importType = resolveImportActorType(raw);
  const system = deepClone(raw.system ?? {}) as Record<string, unknown>;
  if (importType === "robot") {
    applyRobotDenizenSystemDefaults(system);
  } else if (isRobotNpcExport(raw) && raw.type !== "robot") {
    system.bodyType = "robot";
  } else if (typeof system.bodyType === "string") {
    system.bodyType = normalizeFalloutBodyType(system.bodyType);
  }

  const importItems =
    importType === "robot" ? favoriteWeaponsInItemList(items) : items;

  const payload: Record<string, unknown> = {
    name: String(clone.name ?? raw.name ?? "").trim(),
    type: importType,
    system,
  };

  if (typeof clone.img === "string") payload.img = clone.img;
  if (importItems.length) payload.items = importItems;

  return payload;
}

async function repairRobotDenizenActor(actor: Actor, raw: FalloutActorJson): Promise<void> {
  if (actor.type !== "robot") {
    await repairCreatureRobotActorSheet(actor, raw);
    return;
  }

  const updates: Record<string, unknown> = {
    "system.resistance": {
      physical: 0,
      energy: 0,
      radiation: 0,
      poison: 0,
    },
  };

  const itemUpdates: Array<Record<string, unknown>> = [];
  for (const item of actor.items.contents ?? []) {
    if (item.type !== "weapon") continue;
    if ((item.system as { favorite?: boolean }).favorite === true) continue;
    itemUpdates.push({ _id: item.id, "system.favorite": true });
  }

  if (Object.keys(updates).length) {
    await actor.update(updates, SILENT);
  }
  if (itemUpdates.length) {
    await actor.updateEmbeddedDocuments("Item", itemUpdates, SILENT);
  }
}

async function repairCreatureRobotActorSheet(actor: Actor, raw: FalloutActorJson): Promise<void> {
  if (!isRobotNpcExport(raw)) return;

  const updates: Record<string, unknown> = {};
  if (actor.type !== "creature") updates.type = "creature";

  const bodyType = "robot";
  const current = normalizeFalloutBodyType(
    String((actor.system as { bodyType?: string }).bodyType ?? ""),
  );
  if (current !== bodyType) {
    updates["system.bodyType"] = bodyType;
  }

  if (Object.keys(updates).length) {
    await actor.update(updates, SILENT);
  }
}

function findWorldActorByName(name: string): Actor | undefined {
  const lower = name.trim().toLowerCase();
  const actors = (game as { actors?: { values: () => Iterable<Actor> } }).actors;
  if (!actors) return undefined;
  for (const actor of actors.values()) {
    if (actor.name.trim().toLowerCase() === lower) return actor;
  }
  return undefined;
}

function folderParentId(folder: Folder): string | null {
  const id = folder.folder;
  return id == null || id === "" ? null : id;
}

function folderCacheKey(name: string, parentId: string | null): string {
  return `${parentId ?? ""}\0${name}`;
}

function listActorFolders(): Folder[] {
  const folders = (game as { folders?: Iterable<Folder> }).folders;
  if (!folders) return [];
  return Array.from(folders);
}

function findActorFolder(name: string, parentId: string | null): Folder | undefined {
  const targetParent = parentId ?? null;
  for (const folder of listActorFolders()) {
    if (folder.type !== "Actor") continue;
    if (folder.name !== name) continue;
    if (folderParentId(folder) === targetParent) return folder;
  }
  return undefined;
}

const folderIdCache = new Map<string, string>();

async function ensureActorFolder(
  name: string,
  parentId: string | null,
): Promise<string | undefined> {
  const cacheKey = folderCacheKey(name, parentId);
  const cached = folderIdCache.get(cacheKey);
  if (cached) return cached;

  const existing = findActorFolder(name, parentId);
  if (existing) {
    folderIdCache.set(cacheKey, existing.id);
    return existing.id;
  }

  const data: Record<string, unknown> = {
    name,
    type: "Actor",
    folder: parentId,
  };

  const created = await Folder.implementation.createDocuments(
    [data],
    CREATE_OPTIONS,
  );
  const folder = created[0];
  if (!folder) return undefined;

  folderIdCache.set(cacheKey, folder.id);
  return folder.id;
}

async function ensureDenizenBookFolderTree(): Promise<
  Map<DenizenBookFolder, string> | undefined
> {
  folderIdCache.clear();

  const rootId = await ensureActorFolder(DENIZENS_ROOT_FOLDER, null);
  if (!rootId) return undefined;

  const bySubfolder = new Map<DenizenBookFolder, string>();
  for (const subfolder of DENIZEN_BOOK_SUBFOLDERS) {
    const id = await ensureActorFolder(subfolder, rootId);
    if (id) bySubfolder.set(subfolder, id);
  }
  return bySubfolder;
}

async function createActorFromExport(
  data: FalloutActorJson,
  folderId: string | undefined,
): Promise<"created" | "skipped" | "failed"> {
  const name = (data.name ?? "").trim();
  if (!name) return "failed";

  const existing = findWorldActorByName(name);
  if (existing) {
    await repairRobotDenizenActor(existing, data);
    return "skipped";
  }

  normalizeRobotExportJson(data);

  const items = Array.isArray(data.items) ? prepareEmbeddedItems(data.items) : [];
  const actorData = prepareActorCreatePayload(data, items);

  try {
    const created = await Actor.implementation.createDocuments(
      [actorData],
      CREATE_OPTIONS,
    );
    const actor = created[0] ?? null;
    if (!actor) return "failed";

    if (folderId) {
      await actor.update({ folder: folderId }, SILENT);
    }

    await repairRobotDenizenActor(actor, data);

    return "created";
  } catch (err) {
    console.warn(`${MODULE_ID} | failed to import denizen "${name}"`, err);
    return "failed";
  }
}

type DenizenImportRow = {
  data: FalloutActorJson;
  bookFolder: DenizenBookFolder;
};

function pickExportsForImport(
  rows: Array<{ filename: string; data: FalloutActorJson }>,
): DenizenImportRow[] {
  const parsed = rows
    .map(({ filename, data }) => parseDenizenFromActorJson(filename, data))
    .filter((entry): entry is NonNullable<typeof entry> => entry != null);

  const deduped = dedupeDenizenCatalog(parsed);
  const byName = new Map(
    rows.map((row) => [row.data.name?.trim().toLowerCase() ?? "", row.data] as const),
  );
  return deduped
    .map((entry) => {
      const data = byName.get(entry.name.toLowerCase());
      if (!data) return null;
      return {
        data,
        bookFolder: resolveDenizenBookFolder(data),
      };
    })
    .filter((row): row is DenizenImportRow => row != null);
}

export function getBundledDenizenCount(): number {
  return getBundledDenizenExports().length;
}

export async function importBundledDenizens(): Promise<DenizenImportResult> {
  const result: DenizenImportResult = {
    created: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  if (game.system.id !== "fallout") {
    result.errors.push(t("WASTELANDER.Denizens.Import.RequiresFallout"));
    return result;
  }

  if (!game.user?.isGM) {
    result.errors.push(t("WASTELANDER.Denizens.Import.GmOnly"));
    return result;
  }

  const bundled = getBundledDenizenExports();
  if (!bundled.length) {
    result.errors.push(t("WASTELANDER.Denizens.Import.NoBundledFiles"));
    return result;
  }

  const folderTree = await ensureDenizenBookFolderTree();
  if (!folderTree?.size) {
    result.errors.push(t("WASTELANDER.Denizens.Import.FolderFailed"));
    return result;
  }

  const toImport = pickExportsForImport(bundled);

  for (const { data, bookFolder } of toImport) {
    const folderId = folderTree.get(bookFolder);
    const status = await createActorFromExport(data, folderId);
    if (status === "created") result.created += 1;
    else if (status === "skipped") result.skipped += 1;
    else {
      result.failed += 1;
      result.errors.push(data.name ?? "(unnamed)");
    }
  }

  return result;
}

export function notifyDenizenImportResult(result: DenizenImportResult): void {
  if (result.errors.length && result.created === 0 && result.skipped === 0) {
    ui.notifications.error(result.errors[0] ?? t("WASTELANDER.Denizens.Import.Failed"));
    return;
  }

  ui.notifications.info(
    t("WASTELANDER.Denizens.Import.Done", {
      created: result.created,
      skipped: result.skipped,
      failed: result.failed,
    }),
  );

  if (result.errors.length && (result.failed > 0 || result.created > 0)) {
    console.warn(`${MODULE_ID} | denizen import issues`, result.errors);
  }
}
