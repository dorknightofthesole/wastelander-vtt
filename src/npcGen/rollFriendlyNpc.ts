import { t } from "../integrations/i18n.js";
import typeRollBands from "../data/npcGen/type-roll-bands.json";
import { rollNpcGenD20 } from "./npcGenRollChat.js";
import { drawWandererTable } from "./wandererRollTables.js";
import type {
  NpcCharacterType,
  NpcGenderPresentation,
  NpcGeneratorState,
  NpcGenStepId,
} from "./npcGeneratorState.js";
import { nextIncompleteRollStep } from "./npcGeneratorState.js";

type TypeBand = { min: number; max: number; type: NpcCharacterType };

function rollNpcTypeFromD20(face: number): NpcCharacterType {
  const bands = (typeRollBands as { bands: TypeBand[] }).bands ?? [];
  for (const band of bands) {
    if (face >= band.min && face <= band.max) return band.type;
  }
  return "normal";
}

function assertStepOrder(state: NpcGeneratorState, step: NpcGenStepId): void {
  const expected = nextIncompleteRollStep(state);
  if (expected !== step) {
    throw new Error(`Complete "${expected ?? "review"}" before rolling ${step}.`);
  }
}

export async function rollNpcGender(
  state: NpcGeneratorState,
): Promise<NpcGeneratorState> {
  assertStepOrder(state, "gender");
  const face = await rollNpcGenD20({
    labelKey: "WASTELANDER.NpcGen.RollChat.GenderLabel",
    buildDetail: (f) => ({
      detailKey: "WASTELANDER.NpcGen.RollChat.GenderDetail",
      detailData: {
        parity: f % 2 === 1 ? "odd" : "even",
        gender:
          f % 2 === 1
            ? t("WASTELANDER.NpcGen.Gender.Masculine")
            : t("WASTELANDER.NpcGen.Gender.Feminine"),
      },
    }),
  });
  const gender: NpcGenderPresentation = face % 2 === 1 ? "masculine" : "feminine";
  return {
    ...state,
    rolls: { ...state.rolls, gender },
    meta: { ...state.meta, genderD20: face },
    step: "givenName",
  };
}

export async function rollNpcGivenName(
  state: NpcGeneratorState,
): Promise<NpcGeneratorState> {
  assertStepOrder(state, "givenName");
  if (!state.rolls.gender) throw new Error("Roll gender first.");
  const key =
    state.rolls.gender === "masculine" ? "namesMasculine" : "namesFeminine";
  const draw = await drawWandererTable(key);
  return {
    ...state,
    rolls: { ...state.rolls, givenName: draw.label },
    step: "surname",
  };
}

export async function rollNpcSurname(
  state: NpcGeneratorState,
): Promise<NpcGeneratorState> {
  assertStepOrder(state, "surname");
  const draw = await drawWandererTable("surnames");
  return {
    ...state,
    rolls: { ...state.rolls, surname: draw.label },
    step: "age",
  };
}

export async function rollNpcAge(
  state: NpcGeneratorState,
): Promise<NpcGeneratorState> {
  assertStepOrder(state, "age");
  const draw = await drawWandererTable("age");
  return {
    ...state,
    rolls: { ...state.rolls, age: draw.label },
    step: "demeanor",
  };
}

export async function rollNpcDemeanor(
  state: NpcGeneratorState,
): Promise<NpcGeneratorState> {
  assertStepOrder(state, "demeanor");
  const face = await rollNpcGenD20({
    labelKey: "WASTELANDER.NpcGen.RollChat.DemeanorParityLabel",
    buildDetail: (f) => ({
      detailKey: "WASTELANDER.NpcGen.RollChat.DemeanorParityDetail",
      detailData: {
        table:
          f % 2 === 1
            ? t("WASTELANDER.NpcGen.RollChat.OddsTable")
            : t("WASTELANDER.NpcGen.RollChat.EvensTable"),
      },
    }),
  });
  const parity = face % 2 === 1 ? "odds" : "evens";
  const draw = await drawWandererTable(
    parity === "odds" ? "demeanorOdds" : "demeanorEvens",
  );
  return {
    ...state,
    rolls: { ...state.rolls, demeanor: draw.label },
    meta: { ...state.meta, demeanorD20: face, demeanorParity: parity },
    step: "distinctiveFeature1",
  };
}

export async function rollNpcDistinctiveFeature(
  state: NpcGeneratorState,
  which: 1 | 2,
): Promise<NpcGeneratorState> {
  const step: NpcGenStepId =
    which === 1 ? "distinctiveFeature1" : "distinctiveFeature2";
  assertStepOrder(state, step);
  const draw = await drawWandererTable("distinctiveFeatures");
  const features: [string | null, string | null] = [
    ...state.rolls.distinctiveFeatures,
  ];
  features[which - 1] = draw.label;
  return {
    ...state,
    rolls: { ...state.rolls, distinctiveFeatures: features },
    step: which === 1 ? "distinctiveFeature2" : "profession",
  };
}

export async function rollNpcProfession(
  state: NpcGeneratorState,
): Promise<NpcGeneratorState> {
  assertStepOrder(state, "profession");
  const draw = await drawWandererTable("profession");
  return {
    ...state,
    rolls: { ...state.rolls, profession: draw.label },
    step: "secret",
  };
}

export async function rollNpcSecret(
  state: NpcGeneratorState,
): Promise<NpcGeneratorState> {
  assertStepOrder(state, "secret");
  const draw = await drawWandererTable("secret");
  return {
    ...state,
    rolls: { ...state.rolls, secret: draw.label },
    step: "truth",
  };
}

export async function rollNpcTruth(
  state: NpcGeneratorState,
): Promise<NpcGeneratorState> {
  assertStepOrder(state, "truth");
  const draw = await drawWandererTable("truth");
  return {
    ...state,
    rolls: { ...state.rolls, truth: draw.label },
    step: "npcType",
  };
}

export async function rollNpcType(
  state: NpcGeneratorState,
): Promise<NpcGeneratorState> {
  assertStepOrder(state, "npcType");
  const face = await rollNpcGenD20({
    labelKey: "WASTELANDER.NpcGen.RollChat.NpcTypeLabel",
    buildDetail: (f) => {
      const type = rollNpcTypeFromD20(f);
      const typeKey =
        type === "major"
          ? "WASTELANDER.NpcGen.Type.Major"
          : type === "notable"
            ? "WASTELANDER.NpcGen.Type.Notable"
            : "WASTELANDER.NpcGen.Type.Normal";
      return {
        detailKey: "WASTELANDER.NpcGen.RollChat.NpcTypeDetail",
        detailData: { npcType: t(typeKey) },
      };
    },
  });
  const npcType = rollNpcTypeFromD20(face);
  return {
    ...state,
    rolls: {
      ...state.rolls,
      npcType,
      npcTypeRolled: npcType,
    },
    meta: { ...state.meta, npcTypeD20: face },
    step: "gear",
  };
}
