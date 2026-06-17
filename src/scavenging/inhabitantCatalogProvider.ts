import type {
  InhabitantCatalogEntry,
  InhabitantType,
  NpcSize,
} from "./inhabitantCatalog.js";

export type { NpcSize };

export type InhabitantEntry = InhabitantCatalogEntry;

type InhabitantCatalogProvider = () =>
  | InhabitantEntry[]
  | Promise<InhabitantEntry[]>;

let catalogProvider: InhabitantCatalogProvider | null = null;

/** Optional hook for a companion module to supply inhabitant catalog rows at runtime. */
export function registerInhabitantCatalogProvider(
  provider: InhabitantCatalogProvider | null,
): void {
  catalogProvider = provider;
}

function normalizeRows(rows: unknown): InhabitantEntry[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (row) =>
        row &&
        typeof row === "object" &&
        typeof (row as InhabitantEntry).name === "string" &&
        typeof (row as InhabitantEntry).level === "number" &&
        typeof (row as InhabitantEntry).inhabitantType === "string",
    )
    .map((row) => row as InhabitantEntry)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadInhabitantCatalog(): Promise<InhabitantEntry[]> {
  if (!catalogProvider) return [];
  const rows = await catalogProvider();
  return normalizeRows(rows);
}

export function filterInhabitantsByType(
  inhabitants: InhabitantEntry[],
  type: InhabitantType,
): InhabitantEntry[] {
  return inhabitants.filter((row) => row.inhabitantType === type);
}

export function filterInhabitantsByLevelBand(
  inhabitants: InhabitantEntry[],
  locationLevel: number,
): InhabitantEntry[] {
  const min = Math.max(1, locationLevel - 2);
  const max = locationLevel;
  return inhabitants.filter((row) => row.level >= min && row.level <= max);
}
