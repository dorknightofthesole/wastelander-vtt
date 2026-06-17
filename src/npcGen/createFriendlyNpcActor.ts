import { MODULE_ID } from "../constants.js";
import {
  addCompendiumItemToActor,
  listSkillsFromCompendium,
  type FalloutAttributeKey,
} from "../integrations/fallout.js";
import { buildMinimalActorCreatePayload } from "../integrations/actorCreatePayload.js";
import {
  getWorldActor,
  refreshActorsSidebar,
  resolveActorId,
  updateWorldActor,
} from "../integrations/falloutActor.js";
import { applyNpcGear } from "./applyNpcGear.js";
import { buildNpcGenFieldRows } from "./npcGenActorData.js";
import {
  buildCharacterNpcStats,
  type CharacterNpcBuildResult,
} from "./buildCharacterNpcStats.js";
import { syncNpcJournalPage } from "./npcJournalSync.js";
import { renderNpcBiographyHtml } from "./renderNpcJournalHtml.js";
import {
  allRollStepsComplete,
  npcFullName,
  type NpcGeneratorState,
} from "./npcGeneratorState.js";

const SILENT = { render: false } as const;
const CREATE_OPTIONS = { render: false, keepId: false } as const;
const GENERATED_NPCS_ROOT = "Wastelander";
const GENERATED_NPCS_FOLDER = "Generated NPCs";

const ATTR_KEYS: FalloutAttributeKey[] = [
  "str",
  "per",
  "end",
  "cha",
  "int",
  "agi",
  "luc",
];

const folderIdCache = new Map<string, string>();

function folderParentId(folder: Folder): string | null {
  const parent = (folder as { folder?: string | Folder | null }).folder;
  if (parent == null || parent === "") return null;
  if (typeof parent === "string") return parent;
  return parent.id ?? null;
}

function findActorFolder(
  name: string,
  parentId: string | null,
): Folder | undefined {
  for (const folder of game.folders) {
    if (folder.type !== "Actor" || folder.name !== name) continue;
    if (folderParentId(folder) === parentId) return folder;
  }
  return undefined;
}

function folderCacheKey(name: string, parentId: string | null): string {
  return `${parentId ?? ""}\0${name}`;
}

function getActorFolderById(folderId: string): Folder | undefined {
  const folder = game.folders.get(folderId);
  if (!folder || folder.type !== "Actor") return undefined;
  return folder;
}

/** Drop cached ids when the folder was removed or renamed in the sidebar. */
function readValidCachedFolderId(
  cacheKey: string,
  name: string,
  parentId: string | null,
): string | undefined {
  const cached = folderIdCache.get(cacheKey);
  if (!cached) return undefined;
  const folder = getActorFolderById(cached);
  if (!folder || folder.name !== name || folderParentId(folder) !== parentId) {
    folderIdCache.delete(cacheKey);
    return undefined;
  }
  return cached;
}

function purgeFolderCacheEntriesForParent(parentId: string): void {
  for (const [key] of folderIdCache) {
    if (key.startsWith(`${parentId}\0`)) folderIdCache.delete(key);
  }
}

async function ensureActorFolder(
  name: string,
  parentId: string | null,
): Promise<string | undefined> {
  const cacheKey = folderCacheKey(name, parentId);
  const validated = readValidCachedFolderId(cacheKey, name, parentId);
  if (validated) return validated;

  if (parentId != null && !getActorFolderById(parentId)) {
    purgeFolderCacheEntriesForParent(parentId);
    folderIdCache.delete(cacheKey);
    return undefined;
  }

  const existing = findActorFolder(name, parentId);
  if (existing) {
    folderIdCache.set(cacheKey, existing.id);
    return existing.id;
  }

  const [created] = await Folder.implementation.createDocuments(
    [{ name, type: "Actor", folder: parentId }],
    SILENT,
  );
  if (!created) return undefined;
  folderIdCache.set(cacheKey, created.id);
  return created.id;
}

async function ensureGeneratedNpcFolderId(): Promise<string | undefined> {
  let rootId = await ensureActorFolder(GENERATED_NPCS_ROOT, null);
  if (!rootId) {
    folderIdCache.delete(folderCacheKey(GENERATED_NPCS_ROOT, null));
    rootId = await ensureActorFolder(GENERATED_NPCS_ROOT, null);
  }
  if (!rootId || !getActorFolderById(rootId)) return undefined;

  let folderId = await ensureActorFolder(GENERATED_NPCS_FOLDER, rootId);
  if (!folderId) {
    purgeFolderCacheEntriesForParent(rootId);
    folderIdCache.delete(folderCacheKey(GENERATED_NPCS_FOLDER, rootId));
    folderId = await ensureActorFolder(GENERATED_NPCS_FOLDER, rootId);
  }
  return folderId && getActorFolderById(folderId) ? folderId : undefined;
}

async function applyNpcSkills(
  actor: Actor,
  stats: CharacterNpcBuildResult,
): Promise<void> {
  const skillEntries = await listSkillsFromCompendium();
  const byName = new Map(skillEntries.map((entry) => [entry.name, entry]));
  const parent = getWorldActor(resolveActorId(actor));
  const updates: Array<Record<string, unknown>> = [];

  for (const [skillName, rank] of Object.entries(stats.skills)) {
    if (rank <= 0) continue;
    const tagged = stats.tagSkills.includes(skillName);

    const existing = parent.items.find(
      (item) => item.type === "skill" && item.name === skillName,
    );
    if (existing) {
      updates.push({
        _id: existing.id,
        "system.value": rank,
        "system.tag": tagged,
      });
      continue;
    }

    const entry = byName.get(skillName);
    if (!entry?.uuid) continue;
    await addCompendiumItemToActor(parent, entry.uuid, {
      equipApparel: false,
      systemOverrides: { value: rank, tag: tagged },
    });
  }

  if (updates.length) {
    await parent.updateEmbeddedDocuments("Item", updates, SILENT);
  }
}

function buildActorSystemUpdate(
  stats: CharacterNpcBuildResult,
  biographyHtml: string,
  origin?: string | null,
): Record<string, unknown> {
  const update: Record<string, unknown> = {
    "system.level.value": stats.level,
    "system.category": stats.npcType,
    "system.health.max": stats.healthPoints,
    "system.health.value": stats.healthPoints,
    "system.luckPoints": stats.luckPoints,
    "system.biography.value": biographyHtml,
    "system.derived.carryWeight.max": stats.carryWeight,
    "system.derived.carryWeight.value": stats.carryWeight,
  };

  if (stats.keywords.length) {
    update["system.keywords"] = stats.keywords.join(", ");
  }

  const originLabel = origin?.trim();
  if (originLabel) {
    update["system.origin"] = originLabel;
  }

  for (const key of ATTR_KEYS) {
    update[`system.attributes.${key}.value`] = stats.special[key];
  }

  return update;
}

export type CreateFriendlyNpcResult = {
  actor: Actor;
  stats: CharacterNpcBuildResult;
};

let createFriendlyNpcInFlight: Promise<CreateFriendlyNpcResult> | null = null;

export async function createFriendlyNpcActor(
  state: NpcGeneratorState,
  options?: { openSheet?: boolean },
): Promise<CreateFriendlyNpcResult> {
  if (createFriendlyNpcInFlight) {
    await createFriendlyNpcInFlight.catch(() => undefined);
  }

  const run = createFriendlyNpcActorInner(state, options);
  createFriendlyNpcInFlight = run;
  try {
    return await run;
  } finally {
    if (createFriendlyNpcInFlight === run) createFriendlyNpcInFlight = null;
  }
}

async function createFriendlyNpcActorInner(
  state: NpcGeneratorState,
  options?: { openSheet?: boolean },
): Promise<CreateFriendlyNpcResult> {
  if (!allRollStepsComplete(state)) {
    throw new Error("Complete all roll steps before finishing.");
  }

  const stats = buildCharacterNpcStats(state);
  const name = npcFullName(state.rolls);
  if (!name) throw new Error("NPC name is incomplete.");

  const folderId = await ensureGeneratedNpcFolderId();
  // Sync sidebar folder tree before filing the actor (silent folder creates).
  await refreshActorsSidebar(true);

  const biographyHtml = renderNpcBiographyHtml(state, stats);
  const npcGenFields = buildNpcGenFieldRows(state, stats);

  const [created] = await Actor.implementation.createDocuments(
    [
      buildMinimalActorCreatePayload({
        name,
        type: "npc",
        system: {
          level: { value: stats.level },
          category: stats.npcType,
        },
      }),
    ],
    CREATE_OPTIONS,
  );

  if (!created) throw new Error("Failed to create NPC actor.");

  const actorId = created.id;

  const actorUpdate = buildActorSystemUpdate(
    stats,
    biographyHtml,
    state.rolls.profession,
  );
  if (folderId && getActorFolderById(folderId)) {
    actorUpdate.folder = folderId;
  } else if (folderId) {
    console.warn(
      `${MODULE_ID} | Generated NPCs folder id ${folderId} is missing; actor left at directory root.`,
    );
  }

  await updateWorldActor(actorId, actorUpdate);

  const npcGenFlag = {
    generatedAt: Date.now(),
    friendly: true,
    rulebookSection: "characters-p337",
    rolls: state.rolls,
    meta: state.meta,
    review: state.review,
    gear: state.gear,
    stats,
    fields: npcGenFields,
  };

  // Persist rolled traits before skills/gear so the Data tab survives partial failures.
  await getWorldActor(actorId).setFlag(MODULE_ID, "npcGen", npcGenFlag);

  const applyWarnings: string[] = [];

  try {
    await applyNpcSkills(getWorldActor(actorId), stats);
  } catch (error) {
    applyWarnings.push("skills");
    console.warn(`${MODULE_ID} | NPC skill apply failed for ${name}`, error);
  }

  try {
    await applyNpcGear(getWorldActor(actorId), state.rolls, state.gear);
  } catch (error) {
    applyWarnings.push("gear");
    console.warn(`${MODULE_ID} | NPC gear apply failed for ${name}`, error);
  }

  try {
    await syncNpcJournalPage(getWorldActor(actorId), state, stats);
  } catch (error) {
    applyWarnings.push("journal");
    console.warn(`${MODULE_ID} | NPC journal sync failed for ${name}`, error);
  }

  if (applyWarnings.length) {
    console.warn(
      `${MODULE_ID} | Created friendly NPC "${name}" with incomplete apply steps: ${applyWarnings.join(", ")}`,
    );
  }

  await refreshActorsSidebar(true);

  const actor = getWorldActor(actorId);

  if (options?.openSheet) {
    await actor.sheet?.render?.(true);
  }

  return { actor, stats };
}
