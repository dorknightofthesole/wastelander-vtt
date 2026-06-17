export type NpcSize = "big" | "little" | null;

/** Core rulebook inhabitant sidebar folders (Denizens of the Wasteland chapter). */
export type InhabitantBookFolder =
  | "Animals and Insects"
  | "Mutated Humanoids"
  | "Robots"
  | "Super Mutants"
  | "Synths"
  | "Turrets"
  | "Brotherhood of Steel"
  | "Raiders"
  | "Wastelanders";

export type InhabitantType = InhabitantBookFolder | "overseerOverride" | "none";

export const INHABITANT_BOOK_FOLDERS: InhabitantBookFolder[] = [
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

const BOOK_FOLDER_SET = new Set<string>(INHABITANT_BOOK_FOLDERS);

export const LEGACY_INHABITANT_TYPE_MAP: Record<string, InhabitantBookFolder> = {
  animals: "Animals and Insects",
  feralGhouls: "Mutated Humanoids",
  raiders: "Raiders",
  superMutants: "Super Mutants",
  robots: "Robots",
};

export function isInhabitantBookFolder(value: string): value is InhabitantBookFolder {
  return BOOK_FOLDER_SET.has(value);
}

/** Slim row for scavenging inhabitant roster matching (no stat blocks). */
export interface InhabitantCatalogEntry {
  id: string;
  name: string;
  level: number;
  foundryActorType: "npc" | "creature" | "robot";
  inhabitantType: InhabitantType;
  falloutCategory: "normal" | "notable" | "major";
  npcSize: NpcSize;
}
