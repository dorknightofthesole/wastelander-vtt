import {
  isRobotNpcExport,
  type DenizenCatalogEntry,
  type FalloutActorJson,
} from "./denizenCatalogParse.js";

/** Core rulebook “Denizens of the Wasteland” actor sidebar folders. */
export const DENIZENS_ROOT_FOLDER = "Denizens of the Wasteland";

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

/** Subfolder creation order under the root. */
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

/**
 * Map a denizen export to the rulebook sidebar folder (first match wins).
 */
export function resolveDenizenBookFolder(
  data: FalloutActorJson,
  entry?: DenizenCatalogEntry,
): DenizenBookFolder {
  const name = (entry?.name ?? data.name ?? "").trim().toLowerCase();
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

  if (entry?.inhabitantType === "feralGhouls") return "Mutated Humanoids";
  if (entry?.inhabitantType === "superMutants") return "Super Mutants";
  if (entry?.inhabitantType === "robots") return "Robots";
  if (entry?.inhabitantType === "raiders" && data.type === "npc") {
    return "Raiders";
  }

  if (origin.includes("ghoul")) return "Mutated Humanoids";
  if (data.type === "npc") return "Wastelanders";

  return "Animals and Insects";
}
