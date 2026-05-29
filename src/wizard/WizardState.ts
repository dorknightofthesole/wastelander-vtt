import originsData from "../data/origins-core.json";
import { getRequiredPerkCount, type PerkRulesOriginSource } from "./perkRules.js";
import { getEquipmentPack, validateEquipmentChoices } from "./equipmentRules.js";
import { isOriginCompatibleWithActorType } from "./actorTypeRules.js";
import {
  getMaxSkillRankAtCreation,
  getSpecialAttributeMax,
  getSpecialAttributeMin,
  parseOriginSpecialOverrides,
} from "./originRules.js";
import { computeSpecialPointsBudget } from "./specialRules.js";
import {
  BASE_TAG_COUNT,
  getEffectiveSkillRank,
  getSkillBaseRank,
  getSkillPointsBudget,
  getSkillsTagConfig,
  type OriginTagRulesSource,
} from "./skillsRules.js";

export const WIZARD_STEPS = [
  "origin",
  "special",
  "skills",
  "perk",
  "equipment",
  "review",
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number];

const ORIGINS = originsData as (OriginTagRulesSource & PerkRulesOriginSource)[];

function originById(id: string | null): OriginTagRulesSource | undefined {
  if (!id) return undefined;
  return ORIGINS.find((o) => o.id === id);
}

export interface WizardState {
  step: WizardStepId;
  originId: string | null;
  survivorTraitIds: string[];
  survivorExtraPerk: boolean;
  special: {
    str: number;
    per: number;
    end: number;
    cha: number;
    int: number;
    agi: number;
    luc: number;
  };
  specialFocus: keyof WizardState["special"];
  /** Skill rank overrides keyed by compendium skill name. */
  skillRanks: Record<string, number>;
  /** Voluntary + forced tag skill names. */
  taggedSkillNames: string[];
  /** Selected perk compendium UUIDs (creation order). */
  selectedPerkUuids: string[];
  /** Perk UUID highlighted in the detail panel. */
  focusedPerkUuid: string | null;
  /** Equipment pack id within the origin's pack group. */
  selectedEquipmentPackId: string | null;
  /** Pack choice id → selected option id. */
  equipmentChoices: Record<string, string>;
  /** d20 result for personal trinket (1–20), if pack includes one. */
  trinketRoll: number | null;
}

export function createInitialWizardState(): WizardState {
  return {
    step: "origin",
    originId: null,
    survivorTraitIds: [],
    survivorExtraPerk: false,
    special: {
      str: 5,
      per: 5,
      end: 5,
      cha: 5,
      int: 5,
      agi: 5,
      luc: 5,
    },
    specialFocus: "str",
    skillRanks: {},
    taggedSkillNames: [],
    selectedPerkUuids: [],
    focusedPerkUuid: null,
    selectedEquipmentPackId: null,
    equipmentChoices: {},
    trinketRoll: null,
  };
}

export function stepIndex(step: WizardStepId): number {
  return WIZARD_STEPS.indexOf(step);
}

export interface ValidateWizardContext {
  skillNames?: string[];
  /** Perk UUID → whether requirements are met at current S.P.E.C.I.A.L. */
  perkEligibility?: Record<string, boolean>;
  /** Fallout actor document type (`character` or `robot`). */
  actorType?: string;
}

export function validateSkillsStep(
  state: WizardState,
  skillNames: string[],
): string | null {
  const origin = originById(state.originId);
  const tagConfig = getSkillsTagConfig(origin, state.survivorTraitIds);
  const tagged = state.taggedSkillNames;

  for (const forced of tagConfig.forcedTags) {
    if (!tagged.includes(forced.skillName)) {
      return `${forced.skillName} must be a tag skill for your origin.`;
    }
  }

  if (tagged.length !== tagConfig.totalTagSlots) {
    return `Choose exactly ${tagConfig.totalTagSlots} tag skills to continue.`;
  }

  for (let i = 0; i < tagConfig.restrictedExtraSlots.length; i++) {
    const allowed = tagConfig.restrictedExtraSlots[i]!;
    const slotIndex = BASE_TAG_COUNT + i;
    const skillAtSlot = tagged[slotIndex];
    if (!skillAtSlot) {
      return `Choose an extra tag skill (${allowed.join(", ")}).`;
    }
    if (!allowed.includes(skillAtSlot)) {
      return `Your extra tag (4th skill) must be one of: ${allowed.join(", ")}.`;
    }
  }

  const names = skillNames.length
    ? skillNames
    : [...new Set([...tagged, ...Object.keys(state.skillRanks)])];

  for (const name of names) {
    const rank = getEffectiveSkillRank(
      name,
      state.skillRanks,
      tagged,
      tagConfig.forcedTags,
    );
    const base = getSkillBaseRank(name, tagged, tagConfig.forcedTags);
    if (rank < base) {
      return `${name} cannot be below rank ${base}.`;
    }
    const maxRank = getMaxSkillRankAtCreation(state.originId);
    if (rank > maxRank) {
      return `Skills cannot exceed rank ${maxRank} at creation.`;
    }
  }

  const budget = getSkillPointsBudget(
    state.special.int,
    names,
    state.skillRanks,
    tagged,
    tagConfig,
  );
  if (budget.remaining < 0) {
    return "You have spent too many skill points.";
  }
  if (budget.remaining > 0) {
    return `Spend all skill points to continue (${budget.remaining} remaining).`;
  }

  return null;
}

export function isStepComplete(state: WizardState, step: WizardStepId): boolean {
  const idx = stepIndex(step);
  const currentIdx = stepIndex(state.step);
  if (idx > currentIdx) return false;

  switch (step) {
    case "origin":
      return state.originId !== null;
    case "special":
      return validateWizardStep(state, "special", {}) === null;
    case "skills":
      if (idx < currentIdx) return true;
      return false;
    case "perk":
      if (idx < currentIdx) return true;
      return false;
    case "equipment":
      if (idx < currentIdx) return true;
      return false;
    default:
      return idx < currentIdx;
  }
}

/** Validate every step (for Finish on Review). */
export function validateAllWizardSteps(
  state: WizardState,
  context: ValidateWizardContext = {},
): string | null {
  const steps: WizardStepId[] = [
    "origin",
    "special",
    "skills",
    "perk",
    "equipment",
  ];
  for (const step of steps) {
    const err = validateWizardStep(state, step, context);
    if (err) return err;
  }
  return null;
}

export function validateWizardStep(
  state: WizardState,
  step: WizardStepId,
  context: ValidateWizardContext = {},
): string | null {
  switch (step) {
    case "origin":
      if (!state.originId) return "Choose an origin to continue.";
      if (
        context.actorType &&
        !isOriginCompatibleWithActorType(state.originId, context.actorType)
      ) {
        return context.actorType === "robot"
          ? "Choose an origin available on robot sheets (Mister Handy)."
          : "This origin requires a robot actor sheet (create a Mister Handy robot first).";
      }
      if (state.originId === "survivor") {
        if (state.survivorExtraPerk) {
          return state.survivorTraitIds.length === 1
            ? null
            : "As a Survivor (trait + extra perk), choose one trait to continue.";
        }
        return state.survivorTraitIds.length === 2
          ? null
          : "As a Survivor, choose two traits to continue.";
      }
      return null;
    case "special": {
      const origin = originById(state.originId);
      const overrides = parseOriginSpecialOverrides(
        (origin as { specialOverrides?: Record<string, unknown> } | undefined)
          ?.specialOverrides,
      );
      for (const key of Object.keys(state.special) as Array<keyof typeof state.special>) {
        const min = getSpecialAttributeMin(key, overrides);
        const max = getSpecialAttributeMax(key, overrides);
        const value = state.special[key];
        if (value < min || value > max) {
          return `${key.toUpperCase()} must be between ${min} and ${max} for your origin.`;
        }
      }

      const { remaining } = computeSpecialPointsBudget(state.special, {
        originId: state.originId,
        survivorTraitIds: state.survivorTraitIds,
        specialOverrides: overrides,
      });
      if (remaining < 0) return "You have spent too many S.P.E.C.I.A.L. points.";
      return remaining === 0 ? null : "Spend all points to continue.";
    }
    case "skills": {
      if (!context.skillNames?.length) {
        return "Skills list is still loading. Try again in a moment.";
      }
      return validateSkillsStep(state, context.skillNames);
    }
    case "perk": {
      const origin = originById(state.originId);
      const required = getRequiredPerkCount(origin, state.survivorExtraPerk);
      if (state.selectedPerkUuids.length !== required) {
        return `Choose ${required} perk${required === 1 ? "" : "s"} to continue.`;
      }
      const unique = new Set(state.selectedPerkUuids);
      if (unique.size !== state.selectedPerkUuids.length) {
        return "Each perk can only be chosen once.";
      }
      const eligibility = context.perkEligibility ?? {};
      for (const uuid of state.selectedPerkUuids) {
        if (eligibility[uuid] === false) {
          return "A selected perk no longer meets requirements. Pick another.";
        }
      }
      return null;
    }
    case "equipment": {
      if (!state.originId) return "Choose an origin first.";
      const origin = originById(state.originId);
      const groupId = (origin as { equipmentPackId?: string } | undefined)?.equipmentPackId;
      if (!groupId) return "No equipment packs for this origin.";
      if (!state.selectedEquipmentPackId) return "Choose an equipment pack to continue.";
      const pack = getEquipmentPack(groupId, state.selectedEquipmentPackId);
      if (!pack) return "Invalid equipment pack.";
      const choiceErr = validateEquipmentChoices(pack, state.equipmentChoices);
      if (choiceErr) return choiceErr;
      if (pack.hasTrinket && state.trinketRoll === null) {
        return "Roll or enter a d20 for your personal trinket.";
      }
      return null;
    }
    default:
      return null;
  }
}

export function validateCurrentStep(
  state: WizardState,
  context: ValidateWizardContext = {},
): string | null {
  return validateWizardStep(state, state.step, context);
}
