export type NpcCharacterType = "normal" | "notable" | "major";
export type NpcGenderPresentation = "masculine" | "feminine";

import type { GearItemSpec } from "./npcGearMappings.js";

export type NpcGeneratorGearState = {
  denizenCombatItems: GearItemSpec[];
  previewDenizenId: string | null;
};

export function createInitialNpcGeneratorGearState(): NpcGeneratorGearState {
  return { denizenCombatItems: [], previewDenizenId: null };
}

export const NPC_GEN_STEPS = [
  "gender",
  "givenName",
  "surname",
  "age",
  "demeanor",
  "distinctiveFeature1",
  "distinctiveFeature2",
  "profession",
  "secret",
  "truth",
  "npcType",
  "gear",
  "review",
] as const;

const ROLL_STEP_IDS = new Set<NpcGenStepId>([
  "gender",
  "givenName",
  "surname",
  "age",
  "demeanor",
  "distinctiveFeature1",
  "distinctiveFeature2",
  "profession",
  "secret",
  "truth",
  "npcType",
]);

export function isNpcRollStep(step: NpcGenStepId): boolean {
  return ROLL_STEP_IDS.has(step);
}

export type NpcGenStepId = (typeof NPC_GEN_STEPS)[number];

export type NpcGeneratorRollMeta = {
  genderD20?: number;
  demeanorD20?: number;
  demeanorParity?: "odds" | "evens";
  npcTypeD20?: number;
};

export type NpcGeneratorRolls = {
  gender: NpcGenderPresentation | null;
  givenName: string | null;
  surname: string | null;
  age: string | null;
  demeanor: string | null;
  distinctiveFeatures: [string | null, string | null];
  profession: string | null;
  secret: string | null;
  truth: string | null;
  npcType: NpcCharacterType | null;
  npcTypeRolled: NpcCharacterType | null;
};

export type NpcGeneratorReviewOverrides = {
  level: number | null;
  npcType: NpcCharacterType | null;
};

export interface NpcGeneratorState {
  step: NpcGenStepId;
  rolls: NpcGeneratorRolls;
  meta: NpcGeneratorRollMeta;
  review: NpcGeneratorReviewOverrides;
  gear: NpcGeneratorGearState;
}

export function createInitialNpcGeneratorState(): NpcGeneratorState {
  return {
    step: "gender",
    rolls: {
      gender: null,
      givenName: null,
      surname: null,
      age: null,
      demeanor: null,
      distinctiveFeatures: [null, null],
      profession: null,
      secret: null,
      truth: null,
      npcType: null,
      npcTypeRolled: null,
    },
    meta: {},
    review: { level: null, npcType: null },
    gear: createInitialNpcGeneratorGearState(),
  };
}

export function npcFullName(rolls: NpcGeneratorRolls): string {
  const given = rolls.givenName?.trim() ?? "";
  const family = rolls.surname?.trim() ?? "";
  return [given, family].filter(Boolean).join(" ").trim();
}

export function stepIndex(step: NpcGenStepId): number {
  return NPC_GEN_STEPS.indexOf(step);
}

export function isRollStepComplete(
  state: NpcGeneratorState,
  step: NpcGenStepId,
): boolean {
  const { rolls } = state;
  switch (step) {
    case "gender":
      return rolls.gender != null;
    case "givenName":
      return Boolean(rolls.givenName);
    case "surname":
      return Boolean(rolls.surname);
    case "age":
      return Boolean(rolls.age);
    case "demeanor":
      return Boolean(rolls.demeanor);
    case "distinctiveFeature1":
      return Boolean(rolls.distinctiveFeatures[0]);
    case "distinctiveFeature2":
      return Boolean(rolls.distinctiveFeatures[1]);
    case "profession":
      return Boolean(rolls.profession);
    case "secret":
      return Boolean(rolls.secret);
    case "truth":
      return Boolean(rolls.truth);
    case "npcType":
      return rolls.npcType != null;
    case "gear":
    case "review":
      return allRollStepsComplete(state);
    default:
      return false;
  }
}

export function allRollStepsComplete(state: NpcGeneratorState): boolean {
  return (
    isRollStepComplete(state, "gender") &&
    isRollStepComplete(state, "givenName") &&
    isRollStepComplete(state, "surname") &&
    isRollStepComplete(state, "age") &&
    isRollStepComplete(state, "demeanor") &&
    isRollStepComplete(state, "distinctiveFeature1") &&
    isRollStepComplete(state, "distinctiveFeature2") &&
    isRollStepComplete(state, "profession") &&
    isRollStepComplete(state, "secret") &&
    isRollStepComplete(state, "truth") &&
    isRollStepComplete(state, "npcType")
  );
}

export function resolvedNpcType(state: NpcGeneratorState): NpcCharacterType {
  return (
    state.review.npcType ??
    state.rolls.npcType ??
    "normal"
  );
}

export function nextIncompleteRollStep(
  state: NpcGeneratorState,
): NpcGenStepId | null {
  const rollSteps = NPC_GEN_STEPS.filter((s) => isNpcRollStep(s));
  for (const step of rollSteps) {
    if (!isRollStepComplete(state, step)) return step;
  }
  return null;
}
