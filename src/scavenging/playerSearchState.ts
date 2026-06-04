import type {
  ItemCategoryRange,
  LootCategoryKey,
  ScavengerLocation,
} from "./ScavengerLocation.js";

export type PlayerLootRollEntry = {
  id: string;
  category: LootCategoryKey;
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
};

export type ScavengerPlayerSearchState = {
  version: 1;
  searchSuccess: boolean | null;
  searchRollLog?: PlayerSearchRollLog;
  remainingMin: Partial<Record<LootCategoryKey, number>>;
  rollsUsed: Partial<Record<LootCategoryKey, number>>;
  entries: PlayerLootRollEntry[];
  updatedAt: number;
};

export function emptyPlayerSearchState(): ScavengerPlayerSearchState {
  return {
    version: 1,
    searchSuccess: null,
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

  for (const item of location.items) {
    if (item.category === "junk") continue;
    remainingMin[item.category] = item.min;
    rollsUsed[item.category] = 0;
  }

  return {
    version: 1,
    searchSuccess: true,
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

  return {
    version: 1,
    searchSuccess,
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
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : Date.now(),
  };
}

export function getItemRange(
  location: ScavengerLocation,
  category: LootCategoryKey,
): ItemCategoryRange | undefined {
  return location.items.find((i) => i.category === category);
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
