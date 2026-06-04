/** Loot category keys used in location composition and loot rollers. */
export type LootCategoryKey =
  | "ammunition"
  | "armor"
  | "clothing"
  | "food"
  | "beverages"
  | "chems"
  | "junk"
  | "weapons"
  | "weaponsRanged"
  | "weaponsMelee"
  | "weaponsThrown"
  | "oddities";

export type LocationScale = "tiny" | "small" | "average" | "large";
export type LocationDegree = "untouched" | "partly" | "mostly" | "heavily";
export type LocationCategoryId =
  | "residential"
  | "commercial"
  | "industry"
  | "medical"
  | "agriculture"
  | "military";

export type InhabitantType =
  | "animals"
  | "feralGhouls"
  | "raiders"
  | "superMutants"
  | "robots"
  | "none";

export interface ItemCategoryRange {
  category: LootCategoryKey;
  min: number;
  max: number;
}

/** One d20 on the booklet “Other Found Items” table at location creation. */
export interface OtherFoundRoll {
  d20: number;
  category: LootCategoryKey;
}

export interface ScavengerLocationProblems {
  obstacle: boolean;
  hazard: boolean;
  inhabitants: boolean;
  obstacleDifficulty?: number;
  hazardOngoing?: boolean;
  hazardDamageDc?: number;
  inhabitantType?: InhabitantType;
  inhabitantCount?: number;
  inhabitantLevel?: number;
  hasLeader?: boolean;
}

export interface ScavengerLocationRollLog {
  id: string;
  label: string;
  formula?: string;
  total?: number;
  detail?: string;
}

export interface ScavengerLocationLootResult {
  category: LootCategoryKey;
  label: string;
  quantityFormula?: string;
}

export interface ScavengerLocation {
  id: string;
  name: string;
  concept?: string;
  scale: LocationScale;
  categoryId: LocationCategoryId;
  degree: LocationDegree;
  level: number;
  searchDifficulty: number;
  searchMinutes: number;
  items: ItemCategoryRange[];
  /** Resolved d20 rolls for this location’s Other slots (not a loot-table row). */
  otherFoundRolls: OtherFoundRoll[];
  problems: ScavengerLocationProblems;
  partyActorIds: string[];
  sceneId?: string;
  journalId?: string;
  journalPageId?: string;
  rollLog: ScavengerLocationRollLog[];
  searchSimulated?: boolean;
  lootResults?: ScavengerLocationLootResult[];
  createdAt: number;
}

export interface PartyActorRow {
  actorId: string;
  actorName: string;
  userId: string;
  userName: string;
  /** False when the owning player is not logged in (still counts for party size/level). */
  userActive: boolean;
  level: number;
  selected: boolean;
}
