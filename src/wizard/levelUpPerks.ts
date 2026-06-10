import { MODULE_ID } from "../constants.js";
import {
  readActorSpecial,
  type FalloutActorSystemSlice,
} from "../export/actorDerivedStats.js";
import {
  listPerksFromCompendium,
  type PerkCompendiumEntry,
  type PerkRequirementResult,
  type WizardPerkEvaluationContext,
} from "../integrations/fallout.js";
import { slugifyName } from "../utils/slugify.js";

export function perkIdentifierFromName(name: string): string {
  return slugifyName(name);
}

function normalizePerkName(name: string): string {
  return String(name).trim().toLowerCase();
}

/** Read flags without getFlag — inactive module scopes (e.g. babele) throw via getFlag. */
function readItemFlag(item: Item, scope: string, key: string): unknown {
  const bag = item.flags as Record<string, Record<string, unknown>> | undefined;
  return bag?.[scope]?.[key];
}

function readItemFlagString(item: Item, scope: string, key: string): string | undefined {
  const value = readItemFlag(item, scope, key);
  return typeof value === "string" && value.length ? value : undefined;
}

function perkRankFromItem(item: Item): number {
  const sys = item.system as { rank?: { value?: number } };
  const raw = Number(sys.rank?.value ?? 0);
  // Fallout perk items often keep rank.value at 0 even when the perk is owned.
  return raw > 0 ? raw : 1;
}

function perkNamesForItem(item: Item): string[] {
  const names = new Set<string>([item.name]);
  const babele = readItemFlagString(item, "babele", "originalName");
  if (babele) names.add(babele);
  return [...names];
}

function compendiumUuidForItem(item: Item): string | undefined {
  const stats = (item as Item & { _stats?: { compendiumSource?: string } })._stats;
  if (stats?.compendiumSource) return stats.compendiumSource;
  const moduleUuid = readItemFlagString(item, MODULE_ID, "sourceUuid");
  if (moduleUuid) return moduleUuid;
  return undefined;
}

export interface ActorOwnedPerkIndex {
  bySlug: Record<string, number>;
  byUuid: Record<string, number>;
  byName: Record<string, number>;
}

export function readActorOwnedPerkIndex(actor: Actor): ActorOwnedPerkIndex {
  const bySlug: Record<string, number> = {};
  const byUuid: Record<string, number> = {};
  const byName: Record<string, number> = {};

  for (const item of actor.items) {
    if (item.type !== "perk") continue;
    const rank = perkRankFromItem(item);

    for (const name of perkNamesForItem(item)) {
      const slug = perkIdentifierFromName(name);
      bySlug[slug] = Math.max(bySlug[slug] ?? 0, rank);
      byName[normalizePerkName(name)] = Math.max(byName[normalizePerkName(name)] ?? 0, rank);
    }

    const uuid = compendiumUuidForItem(item);
    if (uuid) {
      byUuid[uuid] = Math.max(byUuid[uuid] ?? 0, rank);
    }
  }

  return { bySlug, byUuid, byName };
}

/** @deprecated Use {@link readActorOwnedPerkIndex}. */
export function readActorOwnedPerkRanks(actor: Actor): Record<string, number> {
  return readActorOwnedPerkIndex(actor).bySlug;
}

export function actorPerkMatchesSource(
  item: Item,
  source: { name: string; uuid?: string },
): boolean {
  if (item.type !== "perk") return false;
  const slug = perkIdentifierFromName(source.name);
  if (perkIdentifierFromName(item.name) === slug) return true;
  if (normalizePerkName(item.name) === normalizePerkName(source.name)) return true;
  const babele = readItemFlagString(item, "babele", "originalName");
  if (babele && normalizePerkName(babele) === normalizePerkName(source.name)) return true;
  const compUuid = compendiumUuidForItem(item);
  if (source.uuid && compUuid && compUuid === source.uuid) return true;
  return false;
}

export function findActorPerkItem(
  actor: Actor,
  source: { name: string; uuid?: string },
): Item | undefined {
  return actor.items.find((item) => actorPerkMatchesSource(item, source));
}

export function resolveOwnedRankForPerk(
  perk: { uuid: string; name: string },
  owned: ActorOwnedPerkIndex,
): number {
  const slug = perkIdentifierFromName(perk.name);
  const byName = normalizePerkName(perk.name);
  return Math.max(
    owned.byUuid[perk.uuid] ?? 0,
    owned.bySlug[slug] ?? 0,
    owned.byName[byName] ?? 0,
  );
}

export function buildLevelUpEvaluationContext(actor: Actor): WizardPerkEvaluationContext {
  const system = actor.system as FalloutActorSystemSlice & {
    readMagazines?: string[];
  };
  return {
    special: readActorSpecial(system),
    level: Number(system.level?.value ?? 1),
    readMagazineUuids: [...(system.readMagazines ?? [])],
  };
}

export type LevelUpPerkEntry = PerkCompendiumEntry &
  PerkRequirementResult & {
    ownedRank: number;
    canPurchase: boolean;
  };

export async function listPerksForLevelUp(actor: Actor): Promise<LevelUpPerkEntry[]> {
  const owned = readActorOwnedPerkIndex(actor);
  const ctx = buildLevelUpEvaluationContext(actor);
  const perks = await listPerksFromCompendium(ctx, {
    knownRanksBySlug: owned.bySlug,
    knownRanksByUuid: owned.byUuid,
    knownRanksByName: owned.byName,
  });

  return perks.map((perk) => {
    const ownedRank = resolveOwnedRankForPerk(perk, owned);
    const canPurchase = perk.met && ownedRank < perk.maxRank;
    return { ...perk, ownedRank, canPurchase };
  });
}

export function formatOwnedRankLabel(ownedRank: number, maxRank: number): string {
  if (ownedRank <= 0) return "";
  if (maxRank > 1) return `Rank ${ownedRank}/${maxRank}`;
  return "Owned";
}
