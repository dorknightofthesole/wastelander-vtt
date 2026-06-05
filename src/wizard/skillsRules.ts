export interface OriginTagRulesSource {
  id: string;
  label: string;
  extraTagRules: unknown[];
}

export const BASE_TAG_COUNT = 3;
export const BASE_SKILL_POINTS = 9;
export const TAG_START_RANK = 2;
export const MAX_SKILL_RANK_AT_CREATION = 3;

export interface ExtraTagRule {
  type: "extraTag";
  count: number;
  allowedSkills?: string[];
}

export interface ForcedTagRule {
  type: "forcedTag";
  skillName: string;
  rank: number;
}

export type OriginTagRule = ExtraTagRule | ForcedTagRule;

export interface SkillsTagConfig {
  totalTagSlots: number;
  forcedTags: Array<{ skillName: string; rank: number }>;
  /**
   * Each entry requires one tagged skill from that set (any position).
   * Brotherhood Initiate: one entry → one of four tags must be EW / Science / Repair.
   */
  restrictedExtraSlots: string[][];
  educatedExtraTag: boolean;
}

export function getForcedTagSkillNames(tagConfig: SkillsTagConfig): string[] {
  return tagConfig.forcedTags.map((f) => f.skillName);
}

export function isForcedTagSkill(
  skillName: string,
  tagConfig: SkillsTagConfig,
): boolean {
  return tagConfig.forcedTags.some((f) => f.skillName === skillName);
}

/** Player-chosen tags only (origin forced tags excluded). */
export function getVoluntaryTaggedSkillNames(
  taggedSkillNames: string[],
  tagConfig: SkillsTagConfig,
): string[] {
  const forced = new Set(getForcedTagSkillNames(tagConfig));
  return taggedSkillNames.filter((n) => !forced.has(n));
}

export function countVoluntaryTagged(
  taggedSkillNames: string[],
  tagConfig: SkillsTagConfig,
): number {
  return getVoluntaryTaggedSkillNames(taggedSkillNames, tagConfig).length;
}

/** How many restricted-tag requirements are not yet satisfied. */
export function countUnmetRestrictedTagRequirements(
  taggedSkillNames: string[],
  restrictedExtraSlots: string[][],
): number {
  const pool = [...taggedSkillNames];
  let unmet = 0;
  for (const allowed of restrictedExtraSlots) {
    const idx = pool.findIndex((s) => allowed.includes(s));
    if (idx >= 0) pool.splice(idx, 1);
    else unmet++;
  }
  return unmet;
}

export function canSatisfyRestrictedTagRequirements(
  taggedSkillNames: string[],
  tagConfig: SkillsTagConfig,
): boolean {
  const voluntary = getVoluntaryTaggedSkillNames(taggedSkillNames, tagConfig);
  const unmet = countUnmetRestrictedTagRequirements(
    voluntary,
    tagConfig.restrictedExtraSlots,
  );
  const slotsRemaining = tagConfig.totalTagSlots - voluntary.length;
  return unmet <= slotsRemaining;
}

function restrictedTagRequirementMessage(allowed: string[]): string {
  return `One of your tag skills must be: ${allowed.join(", ")}.`;
}

export interface SkillPointsBudget {
  total: number;
  spent: number;
  remaining: number;
}

export function getSkillsTagConfig(
  origin: OriginTagRulesSource | undefined,
  survivorTraitIds: string[],
): SkillsTagConfig {
  let totalTagSlots = BASE_TAG_COUNT;
  const forcedTags: SkillsTagConfig["forcedTags"] = [];
  const restrictedExtraSlots: string[][] = [];

  for (const raw of origin?.extraTagRules ?? []) {
    const rule = raw as OriginTagRule;
    if (rule.type === "extraTag") {
      totalTagSlots += Number(rule.count) || 0;
      if (rule.allowedSkills?.length) {
        for (let i = 0; i < (Number(rule.count) || 1); i++) {
          restrictedExtraSlots.push([...rule.allowedSkills]);
        }
      }
    } else if (rule.type === "forcedTag") {
      forcedTags.push({
        skillName: rule.skillName,
        rank: Number(rule.rank) || TAG_START_RANK,
      });
    }
  }

  const educatedExtraTag =
    origin?.id === "survivor" && survivorTraitIds.includes("educated");
  if (educatedExtraTag) totalTagSlots += 1;

  return {
    totalTagSlots,
    forcedTags,
    restrictedExtraSlots,
    educatedExtraTag,
  };
}

export function getSkillBaseRank(
  skillName: string,
  taggedSkillNames: string[],
  forcedTags: SkillsTagConfig["forcedTags"],
): number {
  const forced = forcedTags.find((f) => f.skillName === skillName);
  if (forced) return forced.rank;
  return taggedSkillNames.includes(skillName) ? TAG_START_RANK : 0;
}

export function getEffectiveSkillRank(
  skillName: string,
  skillRanks: Record<string, number>,
  taggedSkillNames: string[],
  forcedTags: SkillsTagConfig["forcedTags"],
): number {
  const base = getSkillBaseRank(skillName, taggedSkillNames, forcedTags);
  const stored = skillRanks[skillName];
  if (stored === undefined) return base;
  return Math.max(base, stored);
}

export function getSkillPointsSpent(
  skillNames: string[],
  skillRanks: Record<string, number>,
  taggedSkillNames: string[],
  forcedTags: SkillsTagConfig["forcedTags"],
): number {
  let spent = 0;
  for (const name of skillNames) {
    const base = getSkillBaseRank(name, taggedSkillNames, forcedTags);
    const rank = getEffectiveSkillRank(name, skillRanks, taggedSkillNames, forcedTags);
    spent += Math.max(0, rank - base);
  }
  return spent;
}

export function getSkillPointsBudget(
  intelligence: number,
  skillNames: string[],
  skillRanks: Record<string, number>,
  taggedSkillNames: string[],
  tagConfig: SkillsTagConfig,
): SkillPointsBudget {
  const total = BASE_SKILL_POINTS + intelligence;
  const spent = getSkillPointsSpent(
    skillNames,
    skillRanks,
    taggedSkillNames,
    tagConfig.forcedTags,
  );
  return { total, spent, remaining: total - spent };
}

/**
 * Whether the player may toggle this skill's tag on.
 * `nextTagged` is the list after toggling this skill on (not including forced-only auto tags).
 */
export function canAddSkillTag(
  skillName: string,
  taggedSkillNames: string[],
  tagConfig: SkillsTagConfig,
): { allowed: boolean; reason?: string } {
  if (taggedSkillNames.includes(skillName)) {
    return { allowed: false, reason: "Already tagged." };
  }

  const voluntaryCount = countVoluntaryTagged(taggedSkillNames, tagConfig);
  if (voluntaryCount >= tagConfig.totalTagSlots) {
    return {
      allowed: false,
      reason: `You can only choose ${tagConfig.totalTagSlots} tag skills.`,
    };
  }

  const nextTagged = [...taggedSkillNames, skillName];
  if (!canSatisfyRestrictedTagRequirements(nextTagged, tagConfig)) {
    const voluntaryNext = getVoluntaryTaggedSkillNames(nextTagged, tagConfig);
    const pool = [...voluntaryNext];
    for (const allowed of tagConfig.restrictedExtraSlots) {
      const idx = pool.findIndex((s) => allowed.includes(s));
      if (idx >= 0) pool.splice(idx, 1);
      else {
        return {
          allowed: false,
          reason: restrictedTagRequirementMessage(allowed),
        };
      }
    }
  }

  return { allowed: true };
}

export function canRemoveSkillTag(
  skillName: string,
  tagConfig: SkillsTagConfig,
): { allowed: boolean; reason?: string } {
  const forced = tagConfig.forcedTags.find((f) => f.skillName === skillName);
  if (forced) {
    return {
      allowed: false,
      reason: `${skillName} must remain a tag skill for your origin.`,
    };
  }
  return { allowed: true };
}

export function getTagRulesSummary(
  origin: OriginTagRulesSource | undefined,
  tagConfig: SkillsTagConfig,
): string[] {
  const lines: string[] = [];
  // lines.push(
  //   `Choose ${tagConfig.totalTagSlots} tag skills. Each tag skill starts at rank ${TAG_START_RANK}.`,
  // );

  for (const forced of tagConfig.forcedTags) {
    lines.push(
      `${forced.skillName} is a required tag skill (rank ${forced.rank}) for ${origin?.label ?? "your origin"} and does not count toward your ${tagConfig.totalTagSlots} choices.`,
    );
  }

  if (tagConfig.restrictedExtraSlots.length) {
    const allowed = tagConfig.restrictedExtraSlots[0]!;
    lines.push(
      `One of your ${tagConfig.totalTagSlots} tag skills must be: ${allowed.join(", ")}.`,
    );
  }

  if (tagConfig.educatedExtraTag) {
    lines.push("Educated grants one additional tag skill.");
  }

  return lines;
}

export function ensureForcedTags(
  skillNames: string[],
  taggedSkillNames: string[],
  tagConfig: SkillsTagConfig,
): string[] {
  const forcedFirst = tagConfig.forcedTags
    .map((f) => f.skillName)
    .filter((name) => skillNames.includes(name));
  const rest = taggedSkillNames.filter((n) => !forcedFirst.includes(n));
  return [...forcedFirst, ...rest];
}

export function applyTagOn(
  skillRanks: Record<string, number>,
  skillName: string,
  tagConfig: SkillsTagConfig,
): Record<string, number> {
  const next = { ...skillRanks };
  const current = getEffectiveSkillRank(skillName, next, [skillName], tagConfig.forcedTags);
  if (current < TAG_START_RANK) next[skillName] = TAG_START_RANK;
  return next;
}

export function applyTagOff(
  skillRanks: Record<string, number>,
  skillName: string,
): Record<string, number> {
  const next = { ...skillRanks };
  const stored = next[skillName];
  if (stored === undefined) return next;
  if (stored <= TAG_START_RANK) delete next[skillName];
  else next[skillName] = Math.max(0, stored - TAG_START_RANK);
  return next;
}
