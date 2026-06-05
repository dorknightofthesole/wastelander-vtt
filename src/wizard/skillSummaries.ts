import skillSummariesData from "../data/skill-summaries.json";

const SKILL_SUMMARIES = skillSummariesData as Record<string, string>;

export function getSkillSummary(skillName: string): string {
  return SKILL_SUMMARIES[skillName] ?? "";
}
