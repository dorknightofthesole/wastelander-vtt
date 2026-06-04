import type { InhabitantType } from "./ScavengerLocation.js";

export type NpcSize = "big" | "little" | null;

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

export const INHABITANT_TYPE_OVERRIDES: Record<string, InhabitantType> = {
  gunner: "raiders",
  "children of atom": "raiders",
  "institute scientist": "raiders",
  mercenary: "raiders",
  wastelander: "raiders",
  "vault dweller": "raiders",
  paladin: "raiders",
  knight: "raiders",
  lancer: "raiders",
  elder: "raiders",
  scribe: "raiders",
  minuteman: "raiders",
  "railroad agent": "raiders",
  "trader : caravan merchant": "raiders",
  zetan: "raiders",
};

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

export function inferInhabitantType(
  name: string,
  origin: string,
  actorType: string,
): InhabitantType {
  const key = name.trim().toLowerCase();
  const override = INHABITANT_TYPE_OVERRIDES[key];
  if (override) return override;

  if (actorType === "robot") return "robots";

  const n = key;
  const o = origin.toLowerCase();

  if (
    o.includes("robot") ||
    n.includes("turret") ||
    n.includes("protectron") ||
    n.includes("assaultron") ||
    n.includes("eyebot") ||
    n.includes("sentry bot") ||
    n.includes("mister ") ||
    n.includes("miss nanny") ||
    n.includes("synth")
  ) {
    return "robots";
  }
  if (n.includes("ghoul") || o.includes("ghoul")) return "feralGhouls";
  if (n.includes("mutant") || o.includes("mutant")) return "superMutants";
  if (n.includes("raider") || o.includes("raider")) return "raiders";
  if (actorType === "npc") return "raiders";
  return "animals";
}

export function parseDenizenFromActorJson(
  filename: string,
  data: FalloutActorJson,
): DenizenCatalogEntry | null {
  const name = (data.name ?? filename.replace(/\.json$/i, "")).trim();
  const level = Number(data.system?.level?.value);
  if (!Number.isFinite(level)) return null;

  const foundryActorType = resolveFoundryActorType(data);
  const origin = data.system?.origin?.trim() ?? "";
  const category = data.system?.category;
  const falloutCategory =
    category === "notable" || category === "major" ? category : "normal";

  return {
    id: slugFromFilename(filename),
    name,
    level,
    foundryActorType,
    inhabitantType: inferInhabitantType(name, origin, foundryActorType),
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
