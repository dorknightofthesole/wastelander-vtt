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

import type { InhabitantType } from "./denizenBookFolders.js";

export type { DenizenBookFolder, InhabitantType } from "./denizenBookFolders.js";

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

export interface InhabitantRosterEntry {
  denizenId: string;
  name: string;
  level: number;
  role: "normal" | "leader";
  npcSize?: "big" | "little" | null;
  foundryUuid?: string | null;
}

export interface ScavengerLocationInhabitants {
  type: InhabitantType;
  /** Final count after Big/Little adjustment. */
  count: number;
  /** Count from scale dice before Big/Little. */
  baseCount: number;
  roster: InhabitantRosterEntry[];
}

export type ObstacleType = "mechanical" | "electronic" | "collapsed" | "trap";
export type HazardKind = "ongoing" | "occasional";
/** Ongoing hazard tick rate (booklet: per 10 min, or per min at location level 11+). */
export type HazardOngoingTick = "per10min" | "perMin";

export interface ScavengerLocationProblems {
  obstacle: boolean;
  hazard: boolean;
  inhabitants: boolean;
  obstacleType?: ObstacleType;
  obstacleDifficulty?: number;
  /** 10 × difficulty minutes to bypass (booklet). */
  obstacleBypassMinutes?: number;
  /** GM marks when the party has overcome the obstacle (required before search). */
  obstacleOvercome?: boolean;
  hazardKind?: HazardKind;
  hazardOngoingTick?: HazardOngoingTick;
  /** Occasional hazard only: damage per trigger. */
  hazardDamageDc?: number;
  /** @deprecated Use hazardKind; normalized on load/generate. */
  hazardOngoing?: boolean;
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
  inhabitants?: ScavengerLocationInhabitants;
  problems: ScavengerLocationProblems;
  partyActorIds: string[];
  sceneId?: string;
  journalId?: string;
  journalPageId?: string;
  rollLog: ScavengerLocationRollLog[];
  createdAt: number;
  /** Non-fatal issues from generation (e.g. empty inhabitant pool). */
  warnings?: string[];
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
