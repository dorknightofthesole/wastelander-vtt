export interface ExtraPerkRule {
  type: "extraPerk";
  count: number;
}

export interface PerkRulesOriginSource {
  id: string;
  extraPerkRules?: unknown[];
}

export function getRequiredPerkCount(
  origin: PerkRulesOriginSource | undefined,
  survivorExtraPerk: boolean,
): number {
  let count = 1;
  for (const raw of origin?.extraPerkRules ?? []) {
    const rule = raw as ExtraPerkRule;
    if (rule.type === "extraPerk") count += Number(rule.count) || 0;
  }
  if (origin?.id === "survivor" && survivorExtraPerk) count += 1;
  return count;
}

export function getPerkStepSummary(
  origin: PerkRulesOriginSource | undefined,
  survivorExtraPerk: boolean,
  requiredCount: number,
): string[] {
  const lines: string[] = [
    `Choose ${requiredCount} perk${requiredCount === 1 ? "" : "s"} available at level 1. Requirements must be met.`,
  ];
  if (origin?.id === "survivor" && survivorExtraPerk) {
    lines.push("Survivor: your extra starting perk from “one trait + extra perk.”");
  }
  for (const raw of origin?.extraPerkRules ?? []) {
    const rule = raw as ExtraPerkRule;
    if (rule.type === "extraPerk" && origin.id !== "survivor") {
      lines.push(`Your origin grants ${rule.count} additional starting perk(s).`);
    }
  }
  return lines;
}
