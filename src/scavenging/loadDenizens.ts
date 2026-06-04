import bundledCatalog from "../data/scavenging/denizens-catalog.json";
import type { InhabitantType } from "./ScavengerLocation.js";
import type { DenizenCatalogEntry, NpcSize } from "./denizenCatalogParse.js";

export type { NpcSize };

/** Runtime denizen row (from slim catalog, not full actor exports). */
export type DenizenEntry = DenizenCatalogEntry;

type DenizensCatalogFile = {
  denizens: DenizenCatalogEntry[];
};

let cachedDenizens: DenizenEntry[] | null = null;

function normalizeCatalog(data: unknown): DenizenEntry[] {
  if (!data || typeof data !== "object") return [];
  const denizens = (data as DenizensCatalogFile).denizens;
  if (!Array.isArray(denizens)) return [];
  return denizens
    .filter(
      (d) =>
        d &&
        typeof d.name === "string" &&
        typeof d.level === "number" &&
        typeof d.inhabitantType === "string",
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Loaded from bundled denizens-catalog.json (committed in repo). */
export async function loadDenizens(): Promise<DenizenEntry[]> {
  if (cachedDenizens) return cachedDenizens;
  cachedDenizens = normalizeCatalog(bundledCatalog);
  return cachedDenizens;
}

export function filterDenizensByType(
  denizens: DenizenEntry[],
  type: InhabitantType,
): DenizenEntry[] {
  return denizens.filter((d) => d.inhabitantType === type);
}

export function filterDenizensByLevelBand(
  denizens: DenizenEntry[],
  locationLevel: number,
): DenizenEntry[] {
  const min = Math.max(1, locationLevel - 2);
  const max = locationLevel;
  return denizens.filter((d) => d.level >= min && d.level <= max);
}
