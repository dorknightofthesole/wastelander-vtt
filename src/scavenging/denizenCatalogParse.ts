export type NpcSize = "big" | "little" | null;

/** Core rulebook “Denizens of the Wasteland” actor sidebar folders. */
export type DenizenBookFolder =
  | "Animals and Insects"
  | "Mutated Humanoids"
  | "Robots"
  | "Super Mutants"
  | "Synths"
  | "Turrets"
  | "Brotherhood of Steel"
  | "Raiders"
  | "Wastelanders";

/** Matches “Denizens of the Wasteland” actor sidebar folders, plus overseer-only modes. */
export type InhabitantType = DenizenBookFolder | "overseerOverride" | "none";

export const DENIZEN_BOOK_SUBFOLDERS: DenizenBookFolder[] = [
  "Animals and Insects",
  "Mutated Humanoids",
  "Robots",
  "Super Mutants",
  "Synths",
  "Turrets",
  "Brotherhood of Steel",
  "Raiders",
  "Wastelanders",
];

const BOOK_FOLDER_SET = new Set<string>(DENIZEN_BOOK_SUBFOLDERS);

/** Map legacy scavenging inhabitant keys to book folder names. */
export const LEGACY_INHABITANT_TYPE_MAP: Record<string, DenizenBookFolder> = {
  animals: "Animals and Insects",
  feralGhouls: "Mutated Humanoids",
  raiders: "Raiders",
  superMutants: "Super Mutants",
  robots: "Robots",
};

const BROTHERHOOD_NAMES = new Set([
  "elder",
  "knight",
  "lancer",
  "paladin",
  "scribe",
]);

const WASTELANDER_NAMES = new Set([
  "mercenary",
  "minuteman",
  "railroad agent",
  "trader / caravan merchant",
  "trader : caravan merchant",
  "vault dweller",
  "wastelander",
  "institute scientist",
]);

export function isDenizenBookFolder(value: string): value is DenizenBookFolder {
  return BOOK_FOLDER_SET.has(value);
}

export type FalloutActorJson = {
  name?: string;
  type?: string;
  img?: string;
  system?: {
    level?: { value?: number };
    origin?: string;
    category?: string;
    bodyType?: string;
    attributes?: Record<string, unknown>;
  };
  items?: Array<{ name?: string; type?: string }>;
};

/** Slim denizen row for scavenging (no stat blocks or rulebook prose). */
export interface DenizenCatalogEntry {
  id: string;
  name: string;
  level: number;
  foundryActorType: "npc" | "creature" | "robot";
  inhabitantType: InhabitantType;
  falloutCategory: "normal" | "notable" | "major";
  npcSize: NpcSize;
}

/** Fallout actor.type used when creating world actors from denizen exports. */
export type DenizenImportActorType = "npc" | "creature" | "robot";

/**
 * Fallout's NPC/creature body dropdown uses keys from `CONFIG.FALLOUT.BODY_TYPES`
 * (`humanoid`, `robot`, `quadruped`, `flyingInsect`). Compendium exports often use `"Robot"`.
 */
export function normalizeFalloutBodyType(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "humanoid";
  const lower = trimmed.toLowerCase();
  if (lower === "robot") return "robot";
  if (lower === "humanoid") return "humanoid";
  if (lower === "quadruped") return "quadruped";
  if (lower === "flyinginsect" || lower === "flying insect") return "flyingInsect";
  return trimmed;
}

/** NPC / creature robot stat blocks (bodyType robot), not PC `robot` chassis actors. */
export function isRobotNpcExport(data: FalloutActorJson): boolean {
  const name = (data.name ?? "").trim().toLowerCase();
  const origin = (data.system?.origin ?? "").trim().toLowerCase();
  const bodyType = (data.system?.bodyType ?? "").trim().toLowerCase();

  if (bodyType === "robot") return true;
  if (origin === "robot") return true;

  if (
    name.includes("turret") ||
    name.includes("protectron") ||
    name.includes("assaultron") ||
    name.includes("eyebot") ||
    name.includes("sentry bot") ||
    name.includes("mister ") ||
    name.includes("miss nanny")
  ) {
    return true;
  }

  if (origin.includes("robot") && bodyType !== "humanoid") return true;
  return false;
}

/**
 * Map a denizen export to the rulebook sidebar folder (first match wins).
 * Also used as the scavenging inhabitant type in the denizen catalog.
 */
export function resolveDenizenBookFolder(data: FalloutActorJson): DenizenBookFolder {
  const name = (data.name ?? "").trim().toLowerCase();
  const origin = (data.system?.origin ?? "").trim().toLowerCase();

  if (name.includes("turret")) return "Turrets";
  if (name.includes("synth")) return "Synths";
  if (BROTHERHOOD_NAMES.has(name)) return "Brotherhood of Steel";
  if (
    name.includes("raider") ||
    name === "gunner" ||
    name === "children of atom"
  ) {
    return "Raiders";
  }
  if (name.includes("super mutant") || name === "mutant hound") {
    return "Super Mutants";
  }
  if (WASTELANDER_NAMES.has(name)) return "Wastelanders";
  if (name.includes("ghoul") || name === "glowing one" || name === "zetan") {
    return "Mutated Humanoids";
  }
  if (isRobotNpcExport(data)) return "Robots";

  if (origin.includes("ghoul")) return "Mutated Humanoids";
  if (data.type === "npc") return "Wastelanders";

  return "Animals and Insects";
}

/**
 * Map export JSON to a Foundry actor type (which sheet opens).
 * Denizen robots in the book use `creature` + `system.bodyType: "robot"` (FalloutCreatureSheet),
 * not the PC `robot` type (FalloutPcSheet / chassis modules).
 */
export function resolveImportActorType(data: FalloutActorJson): DenizenImportActorType {
  const exported = data.type;
  if (exported === "npc" || exported === "creature" || exported === "robot") {
    return exported;
  }
  if (data.system?.attributes) return "npc";
  return "creature";
}

/** Fallout robot sheet: Status tab resistance bonuses (flat numbers, not creature DR blocks). */
export const ROBOT_RESISTANCE_BONUSES = {
  physical: 0,
  energy: 0,
  radiation: 0,
  poison: 0,
} as const;

function isPcStyleResistanceBonuses(resistance: unknown): boolean {
  if (!resistance || typeof resistance !== "object") return false;
  const row = resistance as Record<string, unknown>;
  return typeof row.physical === "number" && typeof row.energy === "number";
}

/** Robot actors use PC resistance bonuses; creature exports often carry DR in nested fields. */
export function applyRobotDenizenSystemDefaults(system: Record<string, unknown>): void {
  system.resistance = { ...ROBOT_RESISTANCE_BONUSES };
}

export function favoriteWeaponsInItemList(
  items: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return items.map((item) => {
    if (item.type !== "weapon") return item;
    const system =
      item.system && typeof item.system === "object"
        ? { ...(item.system as Record<string, unknown>) }
        : {};
    system.favorite = true;
    return { ...item, system };
  });
}

/** Normalize robot export JSON (resistance bonuses + favorite weapons). Returns true if mutated. */
export function normalizeRobotExportJson(data: FalloutActorJson): boolean {
  if (data.type !== "robot") return false;

  let changed = false;
  const system = data.system as Record<string, unknown> | undefined;
  if (system) {
    if (!isPcStyleResistanceBonuses(system.resistance)) {
      applyRobotDenizenSystemDefaults(system);
      changed = true;
    }
  }

  if (!Array.isArray(data.items)) return changed;

  const items = data.items as Array<Record<string, unknown>>;
  for (const item of items) {
    if (item.type !== "weapon") continue;
    const itemSystem =
      item.system && typeof item.system === "object"
        ? (item.system as Record<string, unknown>)
        : {};
    if (itemSystem.favorite === true) continue;
    itemSystem.favorite = true;
    item.system = itemSystem;
    changed = true;
  }

  return changed;
}

export function slugFromFilename(filename: string): string {
  return filename
    .replace(/\.json$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function parseNpcSize(items: FalloutActorJson["items"]): NpcSize {
  for (const item of items ?? []) {
    if (item.type !== "special_ability") continue;
    if (item.name === "Big") return "big";
    if (item.name === "Little") return "little";
  }
  return null;
}

/** Slim catalog / scavenging: Foundry `Actor.type` from an export. */
export type FoundryActorType = DenizenCatalogEntry["foundryActorType"];

export function resolveFoundryActorType(data: FalloutActorJson): FoundryActorType {
  const exported = data.type;
  if (exported === "npc" || exported === "creature" || exported === "robot") {
    return exported;
  }
  if (data.system?.attributes) return "npc";
  return "creature";
}

export function parseDenizenFromActorJson(
  filename: string,
  data: FalloutActorJson,
): DenizenCatalogEntry | null {
  const name = (data.name ?? filename.replace(/\.json$/i, "")).trim();
  const level = Number(data.system?.level?.value);
  if (!Number.isFinite(level)) return null;

  const foundryActorType = resolveFoundryActorType(data);
  const category = data.system?.category;
  const falloutCategory =
    category === "notable" || category === "major" ? category : "normal";

  return {
    id: slugFromFilename(filename),
    name,
    level,
    foundryActorType,
    inhabitantType: resolveDenizenBookFolder(data),
    falloutCategory,
    npcSize: parseNpcSize(data.items),
  };
}

function foundryActorTypeRank(type: FoundryActorType): number {
  if (type === "npc") return 3;
  if (type === "robot") return 2;
  return 1;
}

export function dedupeDenizenCatalog(
  entries: DenizenCatalogEntry[],
): DenizenCatalogEntry[] {
  const byName = new Map<string, DenizenCatalogEntry>();
  for (const entry of entries) {
    const key = entry.name.toLowerCase();
    const existing = byName.get(key);
    if (
      !existing ||
      foundryActorTypeRank(entry.foundryActorType) >
        foundryActorTypeRank(existing.foundryActorType)
    ) {
      byName.set(key, entry);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
