import type { FalloutAttributeKey } from "../integrations/fallout.js";
import ageToLevel from "../data/npcGen/age-to-level.json";
import rollToKeywords from "../data/npcGen/roll-to-keywords.json";
import type {
  NpcCharacterType,
  NpcGeneratorRolls,
  NpcGeneratorState,
} from "./npcGeneratorState.js";
import { resolvedNpcType } from "./npcGeneratorState.js";
import {
  mergeSpecialBiases,
  resolveDemeanorMapping,
  resolveProfessionMapping,
  type NpcTraitMapping,
} from "./npcTraitMappings.js";

const ATTR_KEYS: FalloutAttributeKey[] = [
  "str",
  "per",
  "end",
  "cha",
  "int",
  "agi",
  "luc",
];

const MIN_ATTR = 4;
const MAX_ATTR = 10;

export type NpcSpecial = Record<FalloutAttributeKey, number>;

/** @deprecated Use {@link NpcTraitMapping} from npcTraitMappings.ts */
export type ProfessionMapping = NpcTraitMapping;

export type CharacterNpcBuildResult = {
  level: number;
  npcType: NpcCharacterType;
  keywords: string[];
  special: NpcSpecial;
  skills: Record<string, number>;
  tagSkills: string[];
  luckPoints: number;
  healthPoints: number;
  defense: number;
  initiative: number;
  carryWeight: number;
  meleeDamageBonus: number;
};

const AGE_LEVEL = ageToLevel as Record<string, number>;
const KEYWORD_MAP = rollToKeywords as {
  profession: Record<string, string[]>;
  demeanor: Record<string, string[]>;
  distinctiveFeatures: Record<string, string[]>;
  age: Record<string, string[]>;
};

export function computeSpecialBudget(
  level: number,
  npcType: NpcCharacterType,
): number {
  const base =
    npcType === "major" ? 49 : npcType === "notable" ? 42 : 35;
  return base + Math.ceil(level / 2);
}

export function computeTagSkillCount(npcType: NpcCharacterType): number {
  if (npcType === "major") return 4;
  if (npcType === "notable") return 3;
  return 2;
}

export function computeNpcLuckPoints(
  lck: number,
  npcType: NpcCharacterType,
): number {
  if (npcType === "major") return lck;
  if (npcType === "notable") return Math.ceil(lck / 2);
  return 0;
}

export function computeNpcHealthPoints(
  end: number,
  lck: number,
  level: number,
  npcType: NpcCharacterType,
): number {
  if (npcType === "major") return end + level + 2 * lck;
  if (npcType === "notable") return end + level + lck;
  return end + level;
}

export function levelFromAgeLabel(ageLabel: string | null): number {
  if (!ageLabel) return 1;
  const direct = AGE_LEVEL[ageLabel.trim()];
  if (direct) return direct;
  const lower = ageLabel.toLowerCase();
  for (const [key, value] of Object.entries(AGE_LEVEL)) {
    if (key.toLowerCase() === lower) return value;
  }
  return 2;
}

export { resolveProfessionMapping } from "./npcTraitMappings.js";

function skillMappingForRolls(rolls: NpcGeneratorRolls): NpcTraitMapping {
  const profession = resolveProfessionMapping(rolls.profession);
  const demeanor = resolveDemeanorMapping(rolls.demeanor);
  return {
    ...profession,
    skillPriorities: [
      ...(demeanor.skillPriorities ?? []),
      ...(profession.skillPriorities ?? []),
    ],
    tagSkills: profession.tagSkills ?? [],
  };
}

function allocateSpecial(
  budget: number,
  biases: Partial<Record<FalloutAttributeKey, number>>,
): NpcSpecial {
  const special = Object.fromEntries(
    ATTR_KEYS.map((k) => [k, MIN_ATTR]),
  ) as NpcSpecial;

  let remaining = budget - ATTR_KEYS.length * MIN_ATTR;
  if (remaining < 0) remaining = 0;

  const weights = ATTR_KEYS.map((key) => ({
    key,
    weight: Math.max(0, Number(biases[key] ?? 0)),
  }));
  const weightSum = weights.reduce((s, w) => s + w.weight, 0) || ATTR_KEYS.length;

  while (remaining > 0) {
    let placed = false;
    for (const { key, weight } of weights) {
      if (remaining <= 0) break;
      const chance = weight / weightSum;
      if (Math.random() > chance && weightSum > ATTR_KEYS.length) continue;
      if (special[key] >= MAX_ATTR) continue;
      special[key] += 1;
      remaining -= 1;
      placed = true;
    }
    if (!placed) {
      for (const key of ATTR_KEYS) {
        if (remaining <= 0) break;
        if (special[key] < MAX_ATTR) {
          special[key] += 1;
          remaining -= 1;
        }
      }
    }
  }

  return special;
}

function allocateSkills(
  int: number,
  level: number,
  mapping: NpcTraitMapping,
  tagCount: number,
): { skills: Record<string, number>; tagSkills: string[] } {
  const tagSkills = (mapping.tagSkills ?? []).slice(0, tagCount);
  while (tagSkills.length < tagCount) {
    const fallback = (mapping.skillPriorities ?? []).find(
      (s) => !tagSkills.includes(s),
    );
    if (!fallback) break;
    tagSkills.push(fallback);
  }

  const skills: Record<string, number> = {};
  for (const tag of tagSkills) skills[tag] = 2;

  let points = int + level;
  const priorities = [
    ...(mapping.skillPriorities ?? []),
    ...tagSkills,
    "Speech",
    "Survival",
    "Small Guns",
  ];

  for (const skill of priorities) {
    if (points <= 0) break;
    const current = skills[skill] ?? 0;
    if (current >= 5) continue;
    skills[skill] = current + 1;
    points -= 1;
  }

  return { skills, tagSkills };
}

function collectKeywords(rolls: NpcGeneratorRolls): string[] {
  const keywords = new Set<string>();
  const addMapped = (
    table: Record<string, string[]>,
    value: string | null,
  ): void => {
    if (!value) return;
    const direct = table[value.trim()];
    if (direct) {
      for (const kw of direct) keywords.add(kw);
      return;
    }
    const lower = value.trim().toLowerCase();
    for (const [key, list] of Object.entries(table)) {
      if (key.toLowerCase() === lower) {
        for (const kw of list) keywords.add(kw);
      }
    }
  };

  addMapped(KEYWORD_MAP.profession, rolls.profession);
  addMapped(KEYWORD_MAP.demeanor, rolls.demeanor);
  addMapped(KEYWORD_MAP.age, rolls.age);
  for (const feature of rolls.distinctiveFeatures) {
    addMapped(KEYWORD_MAP.distinctiveFeatures, feature);
  }

  return [...keywords];
}

export function buildCharacterNpcStats(
  state: NpcGeneratorState,
): CharacterNpcBuildResult {
  const { rolls, review } = state;
  const npcType = resolvedNpcType(state);
  const level = review.level ?? levelFromAgeLabel(rolls.age);
  const profession = resolveProfessionMapping(rolls.profession);
  const demeanor = resolveDemeanorMapping(rolls.demeanor);
  const skillMapping = skillMappingForRolls(rolls);
  const budget = computeSpecialBudget(level, npcType);
  const special = allocateSpecial(
    budget,
    mergeSpecialBiases(profession.specialBiases, demeanor.specialBiases),
  );
  const tagCount = computeTagSkillCount(npcType);
  const { skills, tagSkills } = allocateSkills(
    special.int,
    level,
    skillMapping,
    tagCount,
  );

  const initiativeBonus =
    npcType === "major" ? 4 : npcType === "notable" ? 2 : 0;
  const defense = special.agi >= 9 ? 2 : 1;
  const initiative = special.per + special.agi + initiativeBonus;
  const carryWeight = 150 + special.str * 10;

  let meleeDamageBonus = 0;
  if (special.str >= 11) meleeDamageBonus = 3;
  else if (special.str >= 9) meleeDamageBonus = 2;
  else if (special.str >= 7) meleeDamageBonus = 1;

  return {
    level,
    npcType,
    keywords: collectKeywords(rolls),
    special,
    skills,
    tagSkills,
    luckPoints: computeNpcLuckPoints(special.luc, npcType),
    healthPoints: computeNpcHealthPoints(
      special.end,
      special.luc,
      level,
      npcType,
    ),
    defense,
    initiative,
    carryWeight,
    meleeDamageBonus,
  };
}

export function previewCharacterNpcStats(
  state: NpcGeneratorState,
): CharacterNpcBuildResult | null {
  if (!rollsCompleteForPreview(state)) return null;
  return buildCharacterNpcStats(state);
}

function rollsCompleteForPreview(state: NpcGeneratorState): boolean {
  const { rolls } = state;
  return Boolean(
    rolls.age &&
      rolls.profession &&
      rolls.distinctiveFeatures[0] &&
      rolls.distinctiveFeatures[1],
  );
}
