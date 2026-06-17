import type { CharacterNpcBuildResult } from "./buildCharacterNpcStats.js";
import { buildProfessionDemeanorGearSections, buildTemplateCombatGearSection } from "./npcGenGear.js";
import { getNpcGenAiPromptTemplate } from "./npcGenAiPromptSettings.js";
import type {
  NpcGeneratorRollMeta,
  NpcGeneratorRolls,
  NpcGeneratorState,
  NpcGenStepId,
} from "./npcGeneratorState.js";
import { npcFullName, resolvedNpcType } from "./npcGeneratorState.js";
import { t } from "../integrations/i18n.js";

export type NpcGenFieldRow = {
  stepId?: NpcGenStepId | "stats";
  label: string;
  value: string;
  detail?: string;
};

const ROLL_FIELD_STEPS: NpcGenStepId[] = [
  "givenName",
  "surname",
  "gender",
  "age",
  "demeanor",
  "distinctiveFeature1",
  "distinctiveFeature2",
  "profession",
  "secret",
  "truth",
  "npcType",
];

function tPlain(
  key: string,
  data?: Record<string, string | number | boolean>,
): string {
  return t(key, data, { glossary: false });
}

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Strip HTML/tooltip markup for clipboard and AI prompts. */
export function toPlainText(text: string): string {
  const raw = String(text ?? "").trim();
  if (!raw) return "";
  if (!/<[^>]+>/.test(raw)) return raw;
  const el = document.createElement("div");
  el.innerHTML = raw;
  return (el.textContent ?? el.innerText ?? raw).replace(/\s+/g, " ").trim();
}

function stepLabel(step: NpcGenStepId): string {
  return tPlain(`WASTELANDER.NpcGen.Steps.${step}`);
}

function genderDisplay(rolls: NpcGeneratorRolls): string {
  if (!rolls.gender) return "—";
  return rolls.gender === "masculine"
    ? tPlain("WASTELANDER.NpcGen.Gender.Masculine")
    : tPlain("WASTELANDER.NpcGen.Gender.Feminine");
}

function npcTypeDisplay(type: string): string {
  switch (type) {
    case "major":
      return tPlain("WASTELANDER.NpcGen.Type.Major");
    case "notable":
      return tPlain("WASTELANDER.NpcGen.Type.Notable");
    default:
      return tPlain("WASTELANDER.NpcGen.Type.Normal");
  }
}

function fieldValueForStep(
  step: NpcGenStepId,
  state: NpcGeneratorState,
): { value: string; detail?: string } {
  const { rolls, meta, review } = state;
  switch (step) {
    case "gender":
      return {
        value: genderDisplay(rolls),
        detail: meta.genderD20 ? `d20: ${meta.genderD20}` : undefined,
      };
    case "givenName":
      return { value: rolls.givenName?.trim() || "—" };
    case "surname":
      return { value: rolls.surname?.trim() || "—" };
    case "age":
      return { value: rolls.age?.trim() || "—" };
    case "demeanor":
      return {
        value: rolls.demeanor?.trim() || "—",
        detail: meta.demeanorD20
          ? `d20: ${meta.demeanorD20}${meta.demeanorParity ? ` (${meta.demeanorParity})` : ""}`
          : undefined,
      };
    case "distinctiveFeature1":
      return { value: rolls.distinctiveFeatures[0]?.trim() || "—" };
    case "distinctiveFeature2":
      return { value: rolls.distinctiveFeatures[1]?.trim() || "—" };
    case "profession":
      return { value: rolls.profession?.trim() || "—" };
    case "secret":
      return { value: rolls.secret?.trim() || "—" };
    case "truth":
      return { value: rolls.truth?.trim() || "—" };
    case "npcType": {
      const type = resolvedNpcType(state);
      let detail: string | undefined;
      if (review.npcType && review.npcType !== rolls.npcTypeRolled) {
        detail = `rolled: ${npcTypeDisplay(rolls.npcTypeRolled ?? "normal")}`;
      } else if (meta.npcTypeD20) {
        detail = `d20: ${meta.npcTypeD20}`;
      }
      return { value: npcTypeDisplay(type), detail };
    }
    default:
      return { value: "—" };
  }
}

export function buildNpcGenFieldRows(
  state: NpcGeneratorState,
  stats?: CharacterNpcBuildResult | null,
): NpcGenFieldRow[] {
  const rows: NpcGenFieldRow[] = [];

  for (const step of ROLL_FIELD_STEPS) {
    const { value, detail } = fieldValueForStep(step, state);
    rows.push({
      stepId: step,
      label: stepLabel(step),
      value,
      detail,
    });
  }

  if (stats) {
    const levelDetail =
      state.review.level != null
        ? `age table → overridden to ${stats.level}`
        : undefined;
    rows.push(
      {
        stepId: "stats",
        label: tPlain("WASTELANDER.NpcGen.Review.Level"),
        value: String(stats.level),
        detail: levelDetail,
      },
      {
        stepId: "stats",
        label: tPlain("WASTELANDER.NpcGen.Review.Special"),
        value: `STR ${stats.special.str} PER ${stats.special.per} END ${stats.special.end} CHA ${stats.special.cha} INT ${stats.special.int} AGI ${stats.special.agi} LCK ${stats.special.luc}`,
      },
      {
        stepId: "stats",
        label: "Keywords",
        value: stats.keywords.join(", ") || "—",
      },
      {
        stepId: "stats",
        label: tPlain("WASTELANDER.NpcGen.Review.Hp"),
        value: String(stats.healthPoints),
      },
      {
        stepId: "stats",
        label: tPlain("WASTELANDER.NpcGen.Review.Tags"),
        value: stats.tagSkills.join(", ") || "—",
      },
    );
  }

  const gearSections = buildProfessionDemeanorGearSections(state.rolls);
  const templateSection = buildTemplateCombatGearSection(
    state.gear.templateCombatItems,
    tPlain("WASTELANDER.NpcGen.Gear.TemplateCombatApproved"),
  );
  const gearLabels = [
    ...gearSections.flatMap((section) =>
      section.rows.map((row) => row.label),
    ),
    ...(templateSection?.rows.map((row) => row.label) ?? []),
  ];
  if (gearLabels.length) {
    rows.push({
      stepId: "stats",
      label: tPlain("WASTELANDER.NpcGen.Gear.Title"),
      value: gearLabels.join("; "),
    });
  }

  return rows;
}

export function formatNpcGenFieldLine(
  row: NpcGenFieldRow,
  options?: { plainText?: boolean },
): string {
  const label = options?.plainText ? toPlainText(row.label) : row.label;
  const value = options?.plainText ? toPlainText(row.value) : row.value;
  const detail = row.detail;
  if (!detail) return `${label}: ${value}`;
  return `${label}: ${value} (${detail})`;
}

export function buildNpcGenAiPrompt(
  state: NpcGeneratorState,
  stats?: CharacterNpcBuildResult | null,
): string {
  const name = npcFullName(state.rolls) || "Unnamed NPC";
  const instructions = getNpcGenAiPromptTemplate();
  const traitLines = buildNpcGenFieldRows(state, stats).map((row) =>
    formatNpcGenFieldLine(row, { plainText: true }),
  );
  return [instructions, "", `Name: ${name}`, ...traitLines].join("\n");
}

export function buildNpcGenTraitsTableHtml(
  rows: NpcGenFieldRow[],
  tableClass = "wastelander-npc-gen-traits-table",
): string {
  const body = rows
    .map((row) => {
      const detail = row.detail
        ? ` <span class="wastelander-npc-gen-field-detail">(${escapeHtml(row.detail)})</span>`
        : "";
      return `<tr><td class="wastelander-npc-gen-field-label">${escapeHtml(row.label)}</td><td class="wastelander-npc-gen-field-value">${escapeHtml(row.value)}${detail}</td></tr>`;
    })
    .join("");
  return `<table class="${tableClass}">
<tbody>${body}</tbody>
</table>`;
}

/** Rolled traits panel for the actor Data tab (no section title). */
export function buildNpcGenFieldsHtml(rows: NpcGenFieldRow[]): string {
  return `<div class="wastelander-npc-gen-actor-data">${buildNpcGenTraitsTableHtml(rows)}</div>`;
}

export function buildNpcGenRollMetaSummary(meta: NpcGeneratorRollMeta): string {
  const parts: string[] = [];
  if (meta.genderD20) parts.push(`gender d20: ${meta.genderD20}`);
  if (meta.demeanorD20) {
    parts.push(
      `demeanor d20: ${meta.demeanorD20}${meta.demeanorParity ? ` (${meta.demeanorParity})` : ""}`,
    );
  }
  if (meta.npcTypeD20) parts.push(`npc type d20: ${meta.npcTypeD20}`);
  return parts.join("; ");
}
