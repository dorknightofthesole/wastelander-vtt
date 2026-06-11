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
  const remainingMin: Partial<Record<LootCategoryKey, number>> = {};
  const rollsUsed: Partial<Record<LootCategoryKey, number>> = {};

  for (const slot of getActiveLootSlots(location)) {
    if (slot.category === "junk") continue;
    remainingMin[slot.category] = slot.min;
    rollsUsed[slot.category] = 0;
  }

  return {
    version: 2,
    searchSuccess: true,
    teamRoles: {},
    assistRolls: {},
    remainingMin,
    rollsUsed,
    entries: [],
    updatedAt: Date.now(),
  };
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
): number {
  return state.remainingMin[category] ?? 0;
}

export function minObligationsDone(
  state: ScavengerPlayerSearchState,
  item: ItemCategoryRange,
): boolean {
  return remainingMinFor(state, item.category) <= 0;
}

export function canRollMin(
  state: ScavengerPlayerSearchState,
  location: ScavengerLocation,
  category: LootCategoryKey,
): boolean {
  if (state.searchSuccess !== true) return false;
  const item = getItemRange(location, category);
  if (!item || item.category === "junk") return false;
  return remainingMinFor(state, category) > 0;
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
  return minObligationsDone(state, item);
}

export function newRollEntryId(): string {
  return `roll-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
