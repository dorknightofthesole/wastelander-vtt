import { MODULE_ID } from "../constants.js";
import { getWorldActor, resolveActorId } from "./falloutActor.js";

export type { WizardRollContext } from "./falloutRollChat.js";
export {
  evaluateFalloutRoll,
  evaluateRoll,
  postWizardRollChat,
} from "./falloutRollChat.js";

export type FalloutAttributeKey = "str" | "per" | "end" | "cha" | "int" | "agi" | "luc";

/**
 * Resolve a compendium item by UUID. Returns null if missing or wrong type.
 */
export async function getCompendiumItem(
  uuid: string,
): Promise<Item | null> {
  if (!uuid) return null;
  try {
    const doc = await fromUuid(uuid);
    return doc instanceof Item ? doc : null;
  } catch {
    return null;
  }
}

/** Open a compendium item's sheet (read-only browse from the wizard). */
export async function openCompendiumItemSheet(uuid: string): Promise<void> {
  if (!uuid) return;
  const item = await getCompendiumItem(uuid);
  if (!item) {
    ui.notifications.warn("Could not find that item in the compendium.");
    return;
  }
  item.sheet.render(true);
}

/**
 * Copy a compendium item onto an actor (same as drag-from-compendium).
 */
const SILENT = { render: false } as const;

export function isEquippableApparel(item: Item): boolean {
  return item.type === "apparel" && isEquippableFalloutGear(item);
}

/** Apparel, robot plating (robot_armor), and robot mods when flagged equippable. */
export function isEquippableFalloutGear(item: Item): boolean {
  if (!Boolean((item.system as { equippable?: boolean }).equippable)) {
    return false;
  }
  return (
    item.type === "apparel" ||
    item.type === "robot_armor" ||
    item.type === "robot_mod"
  );
}

/** Keys that must not be copied onto a new owned item (core drop keeps the rest). */
const ITEM_CREATE_OMIT_KEYS = new Set([
  "_id",
  "folder",
  "ownership",
  "sort",
  "actor",
  "compendium",
  "permission",
  "uuid",
  "documentName",
  "collection",
]);

function applySystemOverrides(
  system: Record<string, unknown>,
  options: {
    quantity?: number;
    equipApparel?: boolean;
    source: Item;
    systemOverrides?: Record<string, unknown>;
  },
): void {
  if (options.quantity !== undefined && "quantity" in system) {
    system.quantity = options.quantity;
  }
  if (options.systemOverrides) {
    Object.assign(system, options.systemOverrides);
  }
  const shouldEquip =
    options.equipApparel !== false && isEquippableFalloutGear(options.source);
  if (shouldEquip) {
    system.equipped = true;
  }
  if (options.source.type === "weapon") {
    system.favorite = true;
  }
}

/** Mark every weapon on the actor as a favorite (Fallout quick-access list). */
export async function favoriteAllWeaponsOnActor(actor: Actor | string): Promise<void> {
  const parent =
    typeof actor === "string"
      ? getWorldActor(actor)
      : getWorldActor(resolveActorId(actor));

  const updates = parent.items
    .filter(
      (item) =>
        item.type === "weapon" &&
        !(item.system as { favorite?: boolean }).favorite,
    )
    .map((item) => ({ _id: item.id, "system.favorite": true }));

  if (updates.length) {
    await Item.implementation.updateDocuments(updates, { parent, ...SILENT });
  }
}

/** Same payload shape as Foundry's ActorSheet._onDropItem. */
export function prepareCompendiumItemCreateData(
  source: Item,
  uuid: string,
  options: {
    quantity?: number;
    equipApparel?: boolean;
    systemOverrides?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  const itemData = foundry.utils.duplicate(
    source.toObject(),
  ) as Record<string, unknown>;
  for (const key of ITEM_CREATE_OMIT_KEYS) {
    delete itemData[key];
  }

  const system = (itemData.system ?? {}) as Record<string, unknown>;
  applySystemOverrides(system, { ...options, source });
  itemData.system = system;

  const stats = {
    ...((itemData._stats as Record<string, unknown> | undefined) ?? {}),
    compendiumSource: uuid,
  };
  itemData._stats = stats;

  return itemData;
}

export async function addCompendiumItemToActor(
  actor: Actor,
  uuid: string,
  options: {
    quantity?: number;
    equipApparel?: boolean;
    systemOverrides?: Record<string, unknown>;
  } = {},
): Promise<Item | null> {
  const parent = getWorldActor(resolveActorId(actor));
  const source = await getCompendiumItem(uuid);
  if (!source) return null;

  const existing = parent.items.find(
    (item) => item.name === source.name && item.type === source.type,
  );
  if (existing) return existing;

  const itemData = prepareCompendiumItemCreateData(source, uuid, options);
  if (!itemData.type || typeof itemData.type !== "string") {
    throw new Error(`Compendium item "${source.name}" has no item type.`);
  }

  const flags = (itemData.flags ?? {}) as Record<string, unknown>;
  const moduleFlags = (flags[MODULE_ID] ?? {}) as Record<string, unknown>;
  moduleFlags.sourceUuid = uuid;
  flags[MODULE_ID] = moduleFlags;
  itemData.flags = flags;

  const created = await parent.createEmbeddedDocuments(
    "Item",
    [itemData],
    SILENT,
  );
  return created[0] ?? null;
}

/**
 * Whether this actor can use the Wastelander creation wizard (human or robot sheet).
 */
export function isFalloutWizardActor(actor: Actor): boolean {
  return (
    game.system.id === "fallout" &&
    (actor.type === "character" || actor.type === "robot")
  );
}

/** @deprecated Prefer {@link isFalloutWizardActor}. */
export function isFalloutPlayerCharacter(actor: Actor): boolean {
  return isFalloutWizardActor(actor);
}

export interface PerkRequirementSummary {
  uuid: string;
  name: string;
  required: number;
  tooltip: string;
}

export interface PerkRequirementsEx {
  level?: number;
  levelIncrease?: number;
  attributes?: Partial<Record<FalloutAttributeKey, { value?: number }>>;
  magazineUuids?: string[];
}

export interface PerkCompendiumEntry {
  id: string;
  uuid: string;
  name: string;
  description: string;
  descriptionHtml: string;
  tooltip: string;
  requirementsEx: PerkRequirementsEx;
  requirementsText: string;
  maxRank: number;
  multiRank: boolean;
}

export interface WizardPerkEvaluationContext {
  special: Record<FalloutAttributeKey, number>;
  /** Character level during creation (default 1). */
  level?: number;
  ownedPerkSlugs?: string[];
  readMagazineUuids?: string[];
}

export interface PerkRequirementResult {
  met: boolean;
  reasons: string[];
}

export interface SkillCompendiumEntry {
  id: string;
  uuid: string;
  name: string;
  defaultAttribute: FalloutAttributeKey;
}

const ATTR_KEYS: FalloutAttributeKey[] = [
  "str",
  "per",
  "end",
  "cha",
  "int",
  "agi",
  "luc",
];

function normalizeAttribute(raw: unknown): FalloutAttributeKey {
  const key = String(raw ?? "str").toLowerCase();
  return (ATTR_KEYS as string[]).includes(key) ? (key as FalloutAttributeKey) : "str";
}

/**
 * All skills from the Fallout `fallout.skills` compendium, sorted for display.
 */
export async function listSkillsFromCompendium(): Promise<SkillCompendiumEntry[]> {
  const pack = game.packs.get("fallout.skills");
  if (!pack) return [];

  const index = await pack.getIndex({
    fields: ["uuid", "name", "system.defaultAttribute"],
  });

  const results: SkillCompendiumEntry[] = [];
  for (const entry of index) {
    const sys = (entry as unknown as { system?: { defaultAttribute?: string } }).system;
    results.push({
      id: String((entry as { _id?: string })._id ?? entry.name),
      uuid: String((entry as { uuid?: string }).uuid ?? ""),
      name: String(entry.name),
      defaultAttribute: normalizeAttribute(sys?.defaultAttribute),
    });
  }

  const attrOrder: Record<FalloutAttributeKey, number> = {
    str: 0,
    per: 1,
    end: 2,
    cha: 3,
    int: 4,
    agi: 5,
    luc: 6,
  };

  results.sort(
    (a, b) =>
      attrOrder[a.defaultAttribute] - attrOrder[b.defaultAttribute] ||
      a.name.localeCompare(b.name),
  );
  return results;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildRequirementsText(reqEx: PerkRequirementsEx | undefined): string {
  if (!reqEx) return "";
  const parts: string[] = [];
  const level = Number(reqEx.level ?? 1);
  if (Number.isFinite(level) && level > 1) parts.push(`Level ${level}+`);
  else parts.push("Level 1+");

  const attrs = reqEx.attributes ?? {};
  const attrParts: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    const required = Number(v?.value ?? 0);
    if (!required) continue;
    attrParts.push(`${String(k).toUpperCase()} ${required}`);
  }
  if (attrParts.length) parts.unshift(attrParts.join(", "));
  const magazines = reqEx.magazineUuids ?? [];
  if (magazines.length) parts.push(`Requires magazine${magazines.length > 1 ? "s" : ""}`);
  return parts.length ? `Requirements: ${parts.join(", ")}` : "";
}

/**
 * Mirror Fallout's perk requirement checks for character creation (level 1).
 */
export function evaluatePerkRequirements(
  requirementsEx: PerkRequirementsEx | undefined,
  ctx: WizardPerkEvaluationContext,
  options: {
    multiRank?: boolean;
    maxRank?: number;
    knownRank?: number;
  } = {},
): PerkRequirementResult {
  const reasons: string[] = [];
  const req = requirementsEx ?? {};
  const level = ctx.level ?? 1;
  const knownRank = options.knownRank ?? 0;
  const maxRank = options.maxRank ?? 1;

  if (knownRank >= maxRank) {
    reasons.push("Already at maximum rank.");
  }

  const nextRank = knownRank + 1;
  const startLevel = Number(req.level ?? 1);
  const levelStep = Number(req.levelIncrease ?? 1);
  const levelRequired = options.multiRank
    ? startLevel + (nextRank - 1) * levelStep
    : startLevel;

  if (level < levelRequired) {
    reasons.push(`Requires level ${levelRequired}.`);
  }

  for (const [attr, spec] of Object.entries(req.attributes ?? {})) {
    const required = Number((spec as { value?: number })?.value ?? 0);
    if (!required) continue;
    const key = attr.toLowerCase() as FalloutAttributeKey;
    const current = ctx.special[key] ?? 0;
    if (current < required) {
      reasons.push(`Requires ${key.toUpperCase()} ${required} (yours: ${current}).`);
    }
  }

  const magazines = req.magazineUuids ?? [];
  const read = new Set(ctx.readMagazineUuids ?? []);
  if (magazines.some((uuid) => !read.has(uuid))) {
    reasons.push("Requires reading specific magazines.");
  }

  return { met: reasons.length === 0, reasons };
}

/**
 * All perks from `fallout.perks` with requirement evaluation for the wizard.
 */
export async function listPerksFromCompendium(
  ctx: WizardPerkEvaluationContext,
): Promise<Array<PerkCompendiumEntry & PerkRequirementResult>> {
  const pack = game.packs.get("fallout.perks");
  if (!pack) return [];

  const index = await pack.getIndex({
    fields: [
      "uuid",
      "name",
      "system.description",
      "system.requirementsEx",
      "system.rank",
    ],
  });

  const results: Array<PerkCompendiumEntry & PerkRequirementResult> = [];
  for (const entry of index) {
    const sys = (entry as unknown as { system?: Record<string, unknown> }).system ?? {};
    const reqEx = (sys.requirementsEx ?? {}) as PerkRequirementsEx;
    const maxRank = Number((sys?.rank as { max?: number })?.max ?? 1) || 1;
    const multiRank = maxRank > 1;
    const descriptionHtml = String(sys?.description ?? "");
    const description = stripHtml(descriptionHtml);
    const requirementsText = buildRequirementsText(reqEx);
    const hasRequirementsInDescription = /\brequirements?\b/i.test(description);
    const tooltip = [description, hasRequirementsInDescription ? "" : requirementsText]
      .filter(Boolean)
      .join("\n\n");

    const evaluation = evaluatePerkRequirements(reqEx, ctx, {
      multiRank,
      maxRank,
      knownRank: 0,
    });

    results.push({
      id: String((entry as { _id?: string })._id ?? entry.name),
      uuid: String((entry as { uuid?: string }).uuid ?? ""),
      name: String(entry.name),
      description,
      descriptionHtml,
      tooltip,
      requirementsEx: reqEx,
      requirementsText,
      maxRank,
      multiRank,
      ...evaluation,
    });
  }

  results.sort((a, b) => {
    if (a.met !== b.met) return a.met ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return results;
}

/**
 * Find perks with S.P.E.C.I.A.L. attribute requirements.
 * Uses the Fallout system's `requirementsEx.attributes` structure.
 */
export async function listPerksRequiringAttribute(
  attribute: FalloutAttributeKey,
): Promise<PerkRequirementSummary[]> {
  const pack = game.packs.get("fallout.perks");
  if (!pack) return [];

  const index = await pack.getIndex({
    fields: ["system.requirementsEx", "system.description", "uuid", "name"],
  });

  const results: PerkRequirementSummary[] = [];
  for (const entry of index) {
    const sys = (entry as unknown as { system?: Record<string, unknown> }).system ?? {};
    const reqEx = sys?.requirementsEx as PerkRequirementsEx | undefined;
    const required = Number(reqEx?.attributes?.[attribute]?.value ?? 0);
    if (!required || required <= 0) continue;
    const description = stripHtml(String(sys?.description ?? ""));
    const reqText = buildRequirementsText(reqEx);
    const hasRequirementsInDescription = /\brequirements?\b/i.test(description);
    const tooltip = [description, hasRequirementsInDescription ? "" : reqText]
      .filter(Boolean)
      .join("\n\n");
    results.push({
      uuid: (entry as { uuid?: string }).uuid as string,
      name: entry.name as string,
      required,
      tooltip,
    });
  }

  results.sort((a, b) => a.required - b.required || a.name.localeCompare(b.name));
  return results;
}
