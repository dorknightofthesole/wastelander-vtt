import typeRollBands from "../data/npcGen/type-roll-bands.json";
import { t } from "../integrations/i18n.js";
import {
  collectTableResultRows,
  labelFromTableResultRow,
} from "../scavenging/rollTableLookup.js";
import { rollNpcGenD20 } from "./npcGenRollChat.js";
import {
  drawWandererTable,
  diagnoseWandererTableKey,
  wandererTablesForNpcStep,
} from "./wandererRollTables.js";
import { gearStepValue } from "./npcGenGear.js";
import type {
  NpcCharacterType,
  NpcGenderPresentation,
  NpcGeneratorState,
  NpcGenStepId,
} from "./npcGeneratorState.js";
import {
  allRollStepsComplete,
  isRollStepComplete,
  npcFullName,
  stepIndex,
} from "./npcGeneratorState.js";
import type { WandererNpcTableKey } from "./wandererTableTitles.js";
import { WANDERER_NPC_TABLE_TITLES } from "./wandererTableTitles.js";

export type NpcStepPickerRow = {
  key: string;
  label: string;
  rangeLabel: string;
  tableTitle: string;
  selected: boolean;
};

type TypeBand = { min: number; max: number; type: NpcCharacterType };

function formatRange(range?: [number, number]): string {
  if (!range || range.length < 2) return "—";
  const low = Math.min(range[0]!, range[1]!);
  const high = Math.max(range[0]!, range[1]!);
  return low === high ? String(low) : `${low}–${high}`;
}

function currentStepValue(state: NpcGeneratorState, step: NpcGenStepId): string {
  const { rolls, meta } = state;
  switch (step) {
    case "gender":
      return rolls.gender
        ? `${rolls.gender === "masculine" ? t("WASTELANDER.NpcGen.Gender.Masculine") : t("WASTELANDER.NpcGen.Gender.Feminine")}${meta.genderD20 ? ` (${meta.genderD20})` : ""}`
        : "";
    case "givenName":
      return rolls.givenName ?? "";
    case "surname":
      return rolls.surname ?? "";
    case "age":
      return rolls.age ?? "";
    case "demeanor":
      return rolls.demeanor ?? "";
    case "distinctiveFeature1":
      return rolls.distinctiveFeatures[0] ?? "";
    case "distinctiveFeature2":
      return rolls.distinctiveFeatures[1] ?? "";
    case "profession":
      return rolls.profession ?? "";
    case "secret":
      return rolls.secret ?? "";
    case "truth":
      return rolls.truth ?? "";
    case "npcType": {
      if (!rolls.npcType) return "";
      const typeKey =
        rolls.npcType === "major"
          ? "WASTELANDER.NpcGen.Type.Major"
          : rolls.npcType === "notable"
            ? "WASTELANDER.NpcGen.Type.Notable"
            : "WASTELANDER.NpcGen.Type.Normal";
      return `${t(typeKey)}${meta.npcTypeD20 ? ` (${meta.npcTypeD20})` : ""}`;
    }
    case "gear":
      return gearStepValue(state);
    case "review":
      return npcFullName(state.rolls);
    default:
      return "";
  }
}

function rowsFromWandererTable(
  key: WandererNpcTableKey,
  selectedLabel: string,
): NpcStepPickerRow[] {
  const diagnostic = diagnoseWandererTableKey(key);
  const table = diagnostic.table;
  if (!table) return [];
  const title = WANDERER_NPC_TABLE_TITLES[key];
  return collectTableResultRows(table)
    .map((row, index) => {
      const label = labelFromTableResultRow(row);
      if (!label) return null;
      return {
        key: `${key}:${index}:${label}`,
        label,
        rangeLabel: formatRange(row.range),
        tableTitle: title,
        selected: normalizeKey(label) === normalizeKey(selectedLabel),
      };
    })
    .filter((row): row is NpcStepPickerRow => row != null)
    .sort((a, b) => a.rangeLabel.localeCompare(b.rangeLabel, undefined, { numeric: true }));
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function inlineGenderRows(state: NpcGeneratorState): NpcStepPickerRow[] {
  const selected = state.rolls.gender;
  return [
    {
      key: "gender:masculine",
      label: t("WASTELANDER.NpcGen.Gender.Masculine"),
      rangeLabel: t("WASTELANDER.NpcGen.Picker.OddD20"),
      tableTitle: "—",
      selected: selected === "masculine",
    },
    {
      key: "gender:feminine",
      label: t("WASTELANDER.NpcGen.Gender.Feminine"),
      rangeLabel: t("WASTELANDER.NpcGen.Picker.EvenD20"),
      tableTitle: "—",
      selected: selected === "feminine",
    },
  ];
}

function inlineNpcTypeRows(state: NpcGeneratorState): NpcStepPickerRow[] {
  const bands = (typeRollBands as { bands: TypeBand[] }).bands ?? [];
  const selected = state.rolls.npcType;
  return bands.map((band) => {
    const typeKey =
      band.type === "major"
        ? "WASTELANDER.NpcGen.Type.Major"
        : band.type === "notable"
          ? "WASTELANDER.NpcGen.Type.Notable"
          : "WASTELANDER.NpcGen.Type.Normal";
    return {
      key: `npcType:${band.type}`,
      label: t(typeKey),
      rangeLabel: `${band.min}–${band.max}`,
      tableTitle: "—",
      selected: selected === band.type,
    };
  });
}

export function buildNpcStepPickerRows(
  step: NpcGenStepId | null,
  state: NpcGeneratorState,
): NpcStepPickerRow[] {
  if (!step || step === "review" || step === "gear") return [];

  const selectedLabel = currentStepValue(state, step);

  switch (step) {
    case "gender":
      return inlineGenderRows(state);
    case "npcType":
      return inlineNpcTypeRows(state);
    case "demeanor": {
      const rows: NpcStepPickerRow[] = [];
      for (const key of ["demeanorOdds", "demeanorEvens"] as const) {
        rows.push(...rowsFromWandererTable(key, state.rolls.demeanor ?? ""));
      }
      return rows;
    }
    default: {
      const keys = wandererTablesForNpcStep(step, state);
      const rows: NpcStepPickerRow[] = [];
      for (const key of keys) {
        rows.push(...rowsFromWandererTable(key, selectedLabel));
      }
      return rows;
    }
  }
}

function advanceStepAfter(step: NpcGenStepId): NpcGenStepId {
  const order: NpcGenStepId[] = [
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
  ];
  const index = order.indexOf(step);
  return order[Math.min(index + 1, order.length - 1)] ?? "review";
}

function mergeStepProgress(
  state: NpcGeneratorState,
  step: NpcGenStepId,
  next: NpcGeneratorState,
): NpcGeneratorState {
  const currentIdx = stepIndex(state.step);
  const targetIdx = stepIndex(step);
  if (currentIdx <= targetIdx) {
    return { ...next, step: advanceStepAfter(step) };
  }
  return { ...next, step: state.step };
}

export function applyManualNpcStepPick(
  state: NpcGeneratorState,
  step: NpcGenStepId,
  row: NpcStepPickerRow,
): NpcGeneratorState {
  let next: NpcGeneratorState = { ...state, rolls: { ...state.rolls }, meta: { ...state.meta } };

  switch (step) {
    case "gender": {
      const gender: NpcGenderPresentation =
        row.key === "gender:feminine" ? "feminine" : "masculine";
      next.rolls.gender = gender;
      next.meta.genderD20 = gender === "masculine" ? 1 : 2;
      break;
    }
    case "npcType": {
      const type = row.key.replace("npcType:", "") as NpcCharacterType;
      const band = (typeRollBands as { bands: TypeBand[] }).bands.find((b) => b.type === type);
      next.rolls.npcType = type;
      next.rolls.npcTypeRolled = type;
      next.meta.npcTypeD20 = band?.min ?? 1;
      break;
    }
    case "givenName":
      next.rolls.givenName = row.label;
      break;
    case "surname":
      next.rolls.surname = row.label;
      break;
    case "age":
      next.rolls.age = row.label;
      break;
    case "demeanor": {
      next.rolls.demeanor = row.label;
      const parity = row.key.startsWith("demeanorOdds:") ? "odds" : "evens";
      next.meta.demeanorParity = parity;
      next.meta.demeanorD20 = parity === "odds" ? 1 : 2;
      break;
    }
    case "distinctiveFeature1":
      next.rolls.distinctiveFeatures = [...state.rolls.distinctiveFeatures];
      next.rolls.distinctiveFeatures[0] = row.label;
      break;
    case "distinctiveFeature2":
      next.rolls.distinctiveFeatures = [...state.rolls.distinctiveFeatures];
      next.rolls.distinctiveFeatures[1] = row.label;
      break;
    case "profession":
      next.rolls.profession = row.label;
      break;
    case "secret":
      next.rolls.secret = row.label;
      break;
    case "truth":
      next.rolls.truth = row.label;
      break;
    default:
      return state;
  }

  return mergeStepProgress(state, step, next);
}

export async function rerollNpcStep(
  state: NpcGeneratorState,
  step: NpcGenStepId,
): Promise<NpcGeneratorState> {
  const preserveStep = state.step;
  let next = { ...state };

  switch (step) {
    case "gender": {
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
      next.rolls.gender = face % 2 === 1 ? "masculine" : "feminine";
      next.meta.genderD20 = face;
      break;
    }
    case "givenName": {
      const key =
        state.rolls.gender === "feminine" ? "namesFeminine" : "namesMasculine";
      const draw = await drawWandererTable(key);
      next.rolls.givenName = draw.label;
      break;
    }
    case "surname": {
      const draw = await drawWandererTable("surnames");
      next.rolls.surname = draw.label;
      break;
    }
    case "age": {
      const draw = await drawWandererTable("age");
      next.rolls.age = draw.label;
      break;
    }
    case "demeanor": {
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
      next.rolls.demeanor = draw.label;
      next.meta.demeanorD20 = face;
      next.meta.demeanorParity = parity;
      break;
    }
    case "distinctiveFeature1":
    case "distinctiveFeature2": {
      const draw = await drawWandererTable("distinctiveFeatures");
      const features: [string | null, string | null] = [
        ...state.rolls.distinctiveFeatures,
      ];
      features[step === "distinctiveFeature1" ? 0 : 1] = draw.label;
      next.rolls.distinctiveFeatures = features;
      break;
    }
    case "profession": {
      const draw = await drawWandererTable("profession");
      next.rolls.profession = draw.label;
      break;
    }
    case "secret": {
      const draw = await drawWandererTable("secret");
      next.rolls.secret = draw.label;
      break;
    }
    case "truth": {
      const draw = await drawWandererTable("truth");
      next.rolls.truth = draw.label;
      break;
    }
    case "npcType": {
      const face = await rollNpcGenD20({
        labelKey: "WASTELANDER.NpcGen.RollChat.NpcTypeLabel",
        buildDetail: (f) => {
          const type = inlineNpcTypeFromD20(f);
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
      const npcType = inlineNpcTypeFromD20(face);
      next.rolls.npcType = npcType;
      next.rolls.npcTypeRolled = npcType;
      next.meta.npcTypeD20 = face;
      break;
    }
    default:
      return state;
  }

  next.step = preserveStep;
  return next;
}

function inlineNpcTypeFromD20(face: number): NpcCharacterType {
  const bands = (typeRollBands as { bands: TypeBand[] }).bands ?? [];
  for (const band of bands) {
    if (face >= band.min && face <= band.max) return band.type;
  }
  return "normal";
}

export function stepHasPicker(step: NpcGenStepId | null): boolean {
  return step != null && step !== "review" && step !== "gear";
}

export function stepValueDisplay(state: NpcGeneratorState, step: NpcGenStepId): string {
  return currentStepValue(state, step);
}

export function stepIsClickable(state: NpcGeneratorState, step: NpcGenStepId): boolean {
  if (step === "gear" || step === "review") {
    return allRollStepsComplete(state);
  }
  return isRollStepComplete(state, step) || state.step === step;
}
