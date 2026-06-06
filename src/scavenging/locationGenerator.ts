import categoriesData from "../data/scavenging/creation/location-categories.json";
import degreeData from "../data/scavenging/creation/degree-reduction.json";
import type {
  ItemCategoryRange,
  LocationCategoryId,
  LocationDegree,
  LocationScale,
  LootCategoryKey,
  OtherFoundRoll,
  ScavengerLocation,
  ScavengerLocationInhabitants,
  ScavengerLocationProblems,
  ScavengerLocationRollLog,
} from "./ScavengerLocation.js";
import {
  getScaleMultiplier,
  getSearchDifficulty,
  SEARCH_TIME_BY_SCALE,
} from "./locationRules.js";
import { buildLocationInhabitants, canHaveInhabitants } from "./inhabitantRules.js";
import { resolveLocationProblems } from "./problemRules.js";
import { rollOtherFoundCategoryDetailed } from "./lootRoller.js";
import { rollLocationLevel } from "./locationRules.js";
import type { InhabitantType } from "./ScavengerLocation.js";
import type { PartyActorRow } from "./ScavengerLocation.js";

type CategorySlots = Record<string, number>;

interface CategoriesFile {
  scaleMultipliers: Record<LocationScale, number>;
  categories: Record<
    LocationCategoryId,
    { label: string; slots: CategorySlots }
  >;
}

const CATEGORIES = categoriesData as CategoriesFile;
const DEGREES = degreeData.degrees as Record<
  LocationDegree,
  { label: string; searchDifficulty: number; minimumsReducedTiny: number }
>;

function randomId(): string {
  return `loc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildBaseItems(
  categoryId: LocationCategoryId,
  scale: LocationScale,
): { items: ItemCategoryRange[]; otherFoundRolls: OtherFoundRoll[] } {
  const def = CATEGORIES.categories[categoryId];
  const scaleMult = CATEGORIES.scaleMultipliers[scale];
  const items: ItemCategoryRange[] = [];
  const otherFoundRolls: OtherFoundRoll[] = [];

  for (const [key, tinyCount] of Object.entries(def.slots)) {
    const count = Number(tinyCount);
    if (key === "other") {
      // Booklet: Other (N) at Tiny → N×scale separate d20 rolls, each adds 1 to that category.
      const otherRolls = count * scaleMult;
      for (let i = 0; i < otherRolls; i++) {
        const resolved = rollOtherFoundCategoryDetailed();
        otherFoundRolls.push(resolved);
        addCategorySlot(items, resolved.category, 1, 1);
      }
      continue;
    }
    addCategorySlot(items, key as LootCategoryKey, count, scaleMult);
  }

  return { items, otherFoundRolls };
}

function addCategorySlot(
  items: ItemCategoryRange[],
  category: LootCategoryKey,
  tinyCount: number,
  scaleMult: number,
): void {
  const amount = tinyCount * scaleMult;
  const existing = items.find((i) => i.category === category);
  if (existing) {
    existing.max += amount;
    existing.min += amount;
  } else {
    items.push({ category, min: amount, max: amount });
  }
}

/**
 * Apply degree reductions per GM Screen booklet (Item Minimums Reduced).
 * GM choice of which categories to reduce is TBD; auto mode uses a simple pass.
 */
export function applyDegreeReduction(
  items: ItemCategoryRange[],
  degree: LocationDegree,
  scale: LocationScale,
  autoAllocate: boolean,
): ItemCategoryRange[] {
  const tinyReduced = DEGREES[degree].minimumsReducedTiny;
  const scaleMult = getScaleMultiplier(scale);
  let points = tinyReduced * scaleMult;

  const result = items.map((i) => ({ ...i }));

  while (points > 0) {
    const candidates = result.filter((i) => i.min > 0 || i.max > 1);
    if (!candidates.length) break;

    let pick: ItemCategoryRange;
    if (autoAllocate) {
      pick = candidates[0]!;
      if (candidates.length > 1) {
        const idx = Math.floor(Math.random() * candidates.length);
        pick = candidates[idx]!;
      }
    } else {
      pick = candidates[0]!;
    }

    if (pick.min > 0) {
      pick.min -= 1;
    } else if (pick.max > 1) {
      pick.max -= 1;
    }
    points -= 1;
  }

  return result;
}

export async function generateScavengerLocation(params: {
  name: string;
  concept?: string;
  scale: LocationScale;
  categoryId: LocationCategoryId;
  degree: LocationDegree;
  party: PartyActorRow[];
  problems: ScavengerLocationProblems;
  levelOverride?: number | null;
  autoAllocateDegree?: boolean;
  sceneId?: string;
  /** Animate only the location-level CD roll (avoids Dice So Nice cancelling an in-flight roll). */
  animateLevelRoll?: boolean;
  /** Animate inhabitant count dice (default false during full generate). */
  animateInhabitantRoll?: boolean;
}): Promise<ScavengerLocation> {
  const rollLog: ScavengerLocationRollLog[] = [];
  const warnings: string[] = [];
  const built = buildBaseItems(params.categoryId, params.scale);
  let items = built.items;

  items = applyDegreeReduction(
    items,
    params.degree,
    params.scale,
    params.autoAllocateDegree ?? true,
  );

  const partyLevelSum = params.party
    .filter((p) => p.selected)
    .reduce((s, p) => s + p.level, 0);
  const degreeExtraDc = DEGREES[params.degree].searchDifficulty;
  const hasProblems =
    params.problems.obstacle ||
    params.problems.hazard ||
    params.problems.inhabitants;

  let level: number;
  if (params.levelOverride != null) {
    level = params.levelOverride;
  } else {
    const levelRoll = await rollLocationLevel({
      partyLevelSum,
      degreeExtraDc,
      hasProblems,
      animate: params.animateLevelRoll ?? true,
    });
    level = levelRoll.level;
    const levelDetailParts: string[] = [];
    if (levelRoll.dcCount === 0) {
      levelDetailParts.push("No party levels selected — level 0");
    } else if (hasProblems && levelRoll.bonusFromEffects > 0) {
      levelDetailParts.push(
        `+${levelRoll.bonusFromEffects} from Effects (problems present)`,
      );
    }
    if (levelRoll.dcRoll.faces.length > 0) {
      levelDetailParts.unshift(`CD [${levelRoll.dcRoll.faces.join(", ")}]`);
    }
    if (levelRoll.bonusFromEffects > 0) {
      levelDetailParts.push(`Final level ${level}`);
    } else if (levelRoll.dcCount > 0) {
      levelDetailParts.push(`Final level ${level}`);
    }
    rollLog.push({
      id: "level",
      label: "Location level",
      formula: levelRoll.dcCount > 0 ? levelRoll.dcRoll.formula : undefined,
      total: level,
      detail: levelDetailParts.length ? levelDetailParts.join("; ") : undefined,
    });
  }

  if (params.levelOverride != null) {
    rollLog.push({
      id: "level",
      label: "Location level",
      detail: "GM override",
      total: level,
    });
  }

  const problems = resolveLocationProblems({ ...params.problems }, level);
  let inhabitants: ScavengerLocationInhabitants | undefined;
  if (!canHaveInhabitants(params.scale) || level < 1) {
    problems.inhabitants = false;
  } else if (problems.inhabitants) {
    const inhabitantType: InhabitantType =
      problems.inhabitantType && problems.inhabitantType !== "none"
        ? problems.inhabitantType
        : "Raiders";
    problems.inhabitantType = inhabitantType;
    problems.inhabitantLevel = level;

    const builtInhabitants = await buildLocationInhabitants({
      scale: params.scale,
      locationLevel: level,
      inhabitantType,
      animateRolls:
        params.animateInhabitantRoll !== false && problems.inhabitants,
    });
    rollLog.push(...builtInhabitants.rollLogs);
    warnings.push(...builtInhabitants.warnings);
    inhabitants = builtInhabitants.inhabitants ?? undefined;
    if (inhabitants) {
      problems.inhabitantCount = inhabitants.count;
      problems.hasLeader = inhabitants.roster.some((r) => r.role === "leader");
    }
  }

  return {
    id: randomId(),
    name: params.name,
    concept: params.concept,
    scale: params.scale,
    categoryId: params.categoryId,
    degree: params.degree,
    level,
    searchDifficulty: getSearchDifficulty(params.degree),
    searchMinutes: SEARCH_TIME_BY_SCALE[params.scale].minutes,
    items,
    otherFoundRolls: built.otherFoundRolls,
    inhabitants,
    problems,
    partyActorIds: params.party.filter((p) => p.selected).map((p) => p.actorId),
    sceneId: params.sceneId,
    rollLog,
    createdAt: Date.now(),
    warnings: warnings.length ? warnings : undefined,
  };
}

export function getCategoryOptions(): Array<{ id: LocationCategoryId; label: string }> {
  return Object.entries(CATEGORIES.categories).map(([id, def]) => ({
    id: id as LocationCategoryId,
    label: def.label,
  }));
}

/** Booklet: Other (N) at Tiny × scale → number of d20 rolls on Other Found Items. */
export function getOtherSlotCount(
  categoryId: LocationCategoryId,
  scale: LocationScale,
): number {
  const tiny = Number(CATEGORIES.categories[categoryId].slots.other ?? 0);
  return tiny * getScaleMultiplier(scale);
}

export function rollOtherSlotsForLog(count: number): ScavengerLocationRollLog[] {
  const logs: ScavengerLocationRollLog[] = [];
  for (let i = 0; i < count; i++) {
    const { d20, category } = rollOtherFoundCategoryDetailed();
    logs.push({
      id: `other-${i}`,
      label: "Other → category",
      formula: "1d20",
      total: d20,
      detail: category,
    });
  }
  return logs;
}
