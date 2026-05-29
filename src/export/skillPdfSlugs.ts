import skillSlugMap from "./fieldMaps/human-v002.json";

/** Fallout skill display name → PDF field slug (without skill_ prefix or _rank/_tag suffix). */
export const SKILL_NAME_TO_PDF_SLUG: Record<string, string> =
  skillSlugMap.skillSlugs as Record<string, string>;

export function skillPdfFieldBase(skillName: string): string | null {
  const slug = SKILL_NAME_TO_PDF_SLUG[skillName];
  if (!slug) return null;
  return `skill_${slug}`;
}
