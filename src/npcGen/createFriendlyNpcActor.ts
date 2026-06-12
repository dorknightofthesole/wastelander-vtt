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

async function ensureActorFolder(
  name: string,
  parentId: string | null,
): Promise<string | undefined> {
  const cacheKey = `${parentId ?? ""}\0${name}`;
  const cached = folderIdCache.get(cacheKey);
  if (cached) return cached;

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
  const rootId = await ensureActorFolder(GENERATED_NPCS_ROOT, null);
  if (!rootId) return undefined;
  return ensureActorFolder(GENERATED_NPCS_FOLDER, rootId);
}

async function applyNpcSkills(
  actor: Actor,
  stats: CharacterNpcBuildResult,
): Promise<void> {
  const skillEntries = await listSkillsFromCompendium();
  const parent = getWorldActor(resolveActorId(actor));

  for (const entry of skillEntries) {
    const rank = stats.skills[entry.name];
    if (rank == null || rank <= 0) continue;
    const tagged = stats.tagSkills.includes(entry.name);

    const existing = parent.items.find(
      (item) => item.type === "skill" && item.name === entry.name,
    );
    if (existing) {
      await Item.implementation.updateDocuments(
        [{ _id: existing.id, "system.value": rank, "system.tag": tagged }],
        { parent, ...SILENT },
      );
      continue;
    }
    if (!entry.uuid) continue;
    await addCompendiumItemToActor(parent, entry.uuid, {
      equipApparel: false,
      systemOverrides: { value: rank, tag: tagged },
    });
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
  const actor = getWorldActor(actorId);

  if (folderId) {
    await updateWorldActor(actorId, { folder: folderId });
  }

  await updateWorldActor(
    actorId,
    buildActorSystemUpdate(stats, biographyHtml, state.rolls.profession),
  );

  await applyNpcSkills(actor, stats);
  await applyNpcGear(actor, state.rolls, state.gear);

  await actor.setFlag(MODULE_ID, "npcGen", {
    generatedAt: Date.now(),
    friendly: true,
    rulebookSection: "characters-p337",
    rolls: state.rolls,
    meta: state.meta,
    review: state.review,
    gear: state.gear,
    stats,
    fields: npcGenFields,
  });

  await syncNpcJournalPage(actor, state, stats);

  await refreshActorsSidebar(true);

  if (options?.openSheet) {
    await actor.sheet?.render?.(true);
  }

  return { actor, stats };
}
