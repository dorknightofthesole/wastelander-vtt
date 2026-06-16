/** Display titles for RollTables imported under Wastelander Rollable Tables → Wanderer. */
export const WANDERER_NPC_TABLE_TITLES = {
  namesMasculine: "NPC Names (Masculine)",
  namesFeminine: "NPC Names (Feminine)",
  surnames: "NPC Surnames",
  age: "NPC Age",
  demeanorOdds: "NPC Demeanor (Odds)",
  demeanorEvens: "NPC Demeanor (Evens)",
  distinctiveFeatures: "NPC Distinctive Features",
  profession: "NPC Profession",
  secret: "NPC Secret Table",
  truth: "NPC Truth",
} as const;

export type WandererNpcTableKey = keyof typeof WANDERER_NPC_TABLE_TITLES;

export const GENERATE_NPC_REQUIRED_TABLES: WandererNpcTableKey[] = [
  "namesMasculine",
  "namesFeminine",
  "surnames",
  "age",
  "demeanorOdds",
  "demeanorEvens",
  "distinctiveFeatures",
  "profession",
  "secret",
  "truth",
];
