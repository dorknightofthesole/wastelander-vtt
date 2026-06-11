import { getActiveItemRange, getActiveLootSlots } from "./sceneLoot.js";
import type {
  ItemCategoryRange,
  LootCategoryKey,
  ScavengerLocation,
} from "./ScavengerLocation.js";

export type PlayerLootRollEntry = {
  id: string;
  category: LootCategoryKey;
  /** Resolved loot table when category is abstract (e.g. weapons → weaponsRanged). */
  resolvedTableCategory?: LootCategoryKey;
  source: "min" | "ap";
  actorId: string;
  userId: string;
  userName: string;
  label: string;
  /** Compendium item UUID when the table result links to an item. */
  itemUuid?: string;
  /** Natural 2d20 (or 3d20) total before luck shifts. */
  baseRollSum?: number;
  rollSum: number;
  quantityFormula?: string;
  luckShift: number;
  luckSpent: number;
  createdAt: number;
};

export type SearchTeamRole = "primary" | "assist" | "none";

export type PlayerSearchRollLog = {
  actorId: string;
  userId: string;
  userName: string;
  targetNumber: number;
  difficulty: number;
  successes: number;
  faces: number[];
  success: boolean;
  detail: string;
  at: number;
  /** Primary roll only — assist successes counted when primary passed. */
  assistBonusSuccesses?: number;
  totalSuccesses?: number;
  bonusApGranted?: number;
};

export type AssistSearchRollLog = {
  actorId: string;
  userId: string;
  userName: string;
  targetNumber: number;
  face: number;
  successes: number;
  /** At least one success on the assist d20. */
  contributesSuccess: boolean;
  detail: string;
  at: number;
};

export type ScavengerPlayerSearchState = {
  version: 2;
  searchSuccess: boolean | null;
  teamRoles: Record<string, SearchTeamRole>;
  assistRolls: Record<string, AssistSearchRollLog>;
  searchRollLog?: PlayerSearchRollLog;
  remainingMin: Partial<Record<LootCategoryKey, number>>;
  rollsUsed: Partial<Record<LootCategoryKey, number>>;
  entries: PlayerLootRollEntry[];
  /** World clock advanced for this search attempt (Simple Calendar). */
  searchTimeAdvanced?: boolean;
  updatedAt: number;
};

export function emptyPlayerSearchState(): ScavengerPlayerSearchState {
  return {
    version: 2,
    searchSuccess: null,
    teamRoles: {},
    assistRolls: {},
    remainingMin: {},
    rollsUsed: {},
    entries: [],
    updatedAt: Date.now(),
  };
}

export function initPlayerSearchOnSuccess(
  location: ScavengerLocation,
): ScavengerPlayerSearchState {
  return syncPlayerSearchLootTracking(location, {
    ...emptyPlayerSearchState(),
    searchSuccess: true,
  });
}

const WEAPON_SUBCATEGORIES = new Set<LootCategoryKey>([
  "weaponsRanged",
  "weaponsMelee",
  "weaponsThrown",
]);

function isWeaponSubcategoryCategory(category: LootCategoryKey): boolean {
  return WEAPON_SUBCATEGORIES.has(category);
}

/** Align remainingMin/rollsUsed with current active loot slots (e.g. weapons → melee+ranged). */
export function syncPlayerSearchLootTracking(
  location: ScavengerLocation,
  state: ScavengerPlayerSearchState,
): ScavengerPlayerSearchState {
  if (state.searchSuccess !== true) return state;

  const remainingMin = { ...state.remainingMin };
  const rollsUsed = { ...state.rollsUsed };
  let changed = false;

  const legacyWeaponsRem = remainingMin.weapons;
  const legacyWeaponsUsed = rollsUsed.weapons;
  const activeSlots = getActiveLootSlots(location).filter((slot) => slot.category !== "junk");
  const hasSplitWeaponSlots = activeSlots.some((slot) =>
    isWeaponSubcategoryCategory(slot.category),
  );

  for (const slot of activeSlots) {
    if (remainingMin[slot.category] === undefined) {
      if (
        hasSplitWeaponSlots &&
        legacyWeaponsRem !== undefined &&
        isWeaponSubcategoryCategory(slot.category)
      ) {
        remainingMin[slot.category] = legacyWeaponsRem;
      } else {
        remainingMin[slot.category] = slot.min;
      }
      changed = true;
    }

    if (rollsUsed[slot.category] === undefined) {
      if (
        hasSplitWeaponSlots &&
        legacyWeaponsUsed !== undefined &&
        isWeaponSubcategoryCategory(slot.category)
      ) {
        rollsUsed[slot.category] = legacyWeaponsUsed;
      } else {
        rollsUsed[slot.category] = 0;
      }
      changed = true;
    }
  }

  if (hasSplitWeaponSlots && legacyWeaponsRem !== undefined) {
    delete remainingMin.weapons;
    changed = true;
  }
  if (hasSplitWeaponSlots && legacyWeaponsUsed !== undefined) {
    delete rollsUsed.weapons;
    changed = true;
  }

  if (!changed) return state;
  return { ...state, remainingMin, rollsUsed, updatedAt: Date.now() };
}

export function normalizePlayerSearch(
  raw: unknown,
): ScavengerPlayerSearchState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const data = raw as Partial<ScavengerPlayerSearchState>;
  const searchSuccess =
    data.searchSuccess === true
      ? true
      : data.searchSuccess === false
        ? false
        : null;

  const teamRoles =
    data.teamRoles && typeof data.teamRoles === "object"
      ? { ...(data.teamRoles as Record<string, SearchTeamRole>) }
      : {};
  const assistRolls =
    data.assistRolls && typeof data.assistRolls === "object"
      ? { ...(data.assistRolls as Record<string, AssistSearchRollLog>) }
      : {};

  return {
    version: 2,
    searchSuccess,
    teamRoles,
    assistRolls,
    searchRollLog:
      data.searchRollLog && typeof data.searchRollLog === "object"
        ? (data.searchRollLog as PlayerSearchRollLog)
        : undefined,
    remainingMin:
      data.remainingMin && typeof data.remainingMin === "object"
        ? { ...(data.remainingMin as Record<LootCategoryKey, number>) }
        : {},
    rollsUsed:
      data.rollsUsed && typeof data.rollsUsed === "object"
        ? { ...(data.rollsUsed as Record<LootCategoryKey, number>) }
        : {},
    entries: Array.isArray(data.entries)
      ? (data.entries as PlayerLootRollEntry[])
      : [],
    searchTimeAdvanced: data.searchTimeAdvanced === true,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
  };
}

export function getItemRange(
  location: ScavengerLocation,
  category: LootCategoryKey,
): ItemCategoryRange | undefined {
  return getActiveItemRange(location, category);
}

export function rollsUsedFor(
  state: ScavengerPlayerSearchState,
  category: LootCategoryKey,
): number {
  return state.rollsUsed[category] ?? 0;
}

export function remainingMinFor(
  state: ScavengerPlayerSearchState,
  category: LootCategoryKey,
  location?: ScavengerLocation,
): number {
  const stored = state.remainingMin[category];
  if (stored !== undefined) return stored;

  if (location && state.searchSuccess === true) {
    if (isWeaponSubcategoryCategory(category)) {
      const legacy = state.remainingMin.weapons;
      if (legacy !== undefined) return legacy;
    }
    const item = getActiveItemRange(location, category);
    if (item && item.min > 0) return item.min;
  }

  return 0;
}

export function minObligationsDone(
  state: ScavengerPlayerSearchState,
  item: ItemCategoryRange,
  location?: ScavengerLocation,
): boolean {
  return remainingMinFor(state, item.category, location) <= 0;
}

export function canRollMin(
  state: ScavengerPlayerSearchState,
  location: ScavengerLocation,
  category: LootCategoryKey,
): boolean {
  if (state.searchSuccess !== true) return false;
  const item = getItemRange(location, category);
  if (!item || item.category === "junk") return false;
  return remainingMinFor(state, category, location) > 0;
}

export function canSpendApOnCategory(
  state: ScavengerPlayerSearchState,
  location: ScavengerLocation,
  category: LootCategoryKey,
): boolean {
  if (state.searchSuccess !== true) return false;
  const item = getItemRange(location, category);
  if (!item || item.category === "junk") return false;
  if (rollsUsedFor(state, category) >= item.max) return false;
  if (item.min === 0) return true;
  return minObligationsDone(state, item, location);
}

export function newRollEntryId(): string {
  return `roll-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
