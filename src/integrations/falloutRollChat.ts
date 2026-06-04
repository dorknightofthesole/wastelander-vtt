import { MODULE_PATH } from "../constants.js";
import { evaluateFoundryRoll } from "./foundryRoll.js";

export type WizardRollContext = {
  actor?: Actor | null;
  itemName?: string;
  label: string;
  detail?: string;
};

type DieTerm = {
  denomination?: string | number;
  faces?: number;
  results?: Array<{ result: number; active?: boolean }>;
};

type CdDieDisplay = {
  face: number;
  effectClass: string;
};

type RollBreakdown = {
  modifier: number;
  cdDice: CdDieDisplay[];
  d20Faces: number[];
};

function isCombatDieEffectFace(face: number): boolean {
  return face === 5 || face === 6;
}

function getFalloutGlobal(): FalloutGlobal | undefined {
  return (globalThis as { fallout?: FalloutGlobal }).fallout;
}

function getOtherChatMessageStyle(): number {
  const styles = getFalloutGlobal()?.utils?.getMessageStyles?.();
  if (styles?.OTHER !== undefined) return styles.OTHER;
  return CONST.CHAT_MESSAGE_STYLES.OTHER;
}

function isDieTerm(term: unknown): term is DieTerm {
  return (
    typeof term === "object" &&
    term !== null &&
    "results" in term &&
    Array.isArray((term as DieTerm).results)
  );
}

function isNumericTerm(term: unknown): term is { number: number } {
  return (
    typeof term === "object" &&
    term !== null &&
    "number" in term &&
    typeof (term as { number: unknown }).number === "number" &&
    !("results" in term)
  );
}

function getDieFaces(term: DieTerm): number[] {
  return (
    term.results
      ?.filter((result) => result.active !== false)
      .map((result) => result.result) ?? []
  );
}

function getRollDice(roll: Roll): DieTerm[] {
  const rollDice = roll.dice;
  if (rollDice?.length) return rollDice;
  return (roll.terms ?? []).filter(isDieTerm);
}

/** Fallout registers combat dice as denomination `c` (formula: `5dc`). */
function isCombatDieTerm(term: DieTerm, formula: string): boolean {
  const denom = String(term.denomination ?? "").toLowerCase();
  if (denom === "c") return true;
  if (denom === "20") return false;
  return formula.includes("dc") && (term.faces === 6 || term.faces === undefined);
}

function parseRollBreakdown(roll: Roll, formula: string): RollBreakdown {
  let modifier = 0;
  const cdDice: CdDieDisplay[] = [];
  const d20Faces: number[] = [];

  for (const term of roll.terms ?? []) {
    if (isNumericTerm(term)) {
      modifier += term.number;
    }
  }

  for (const die of getRollDice(roll)) {
    const faces = getDieFaces(die);
    if (isCombatDieTerm(die, formula)) {
      for (const face of faces) {
        cdDice.push({
          face,
          effectClass: isCombatDieEffectFace(face) ? " effect" : "",
        });
      }
      continue;
    }

    if (String(die.denomination ?? "") === "20") {
      d20Faces.push(...faces);
    }
  }

  return { modifier, cdDice, d20Faces };
}

export async function evaluateRoll(
  formula: string,
  options?: { animate?: boolean },
): Promise<{ roll: Roll; total: number; formula: string }> {
  const normalized = formula.replace(/\s+/g, "").toLowerCase();
  const roll = await evaluateFoundryRoll(normalized, options);
  return {
    formula: normalized,
    roll,
    total: Math.floor(Number(roll.total ?? 0)),
  };
}

export async function postWizardRollChat(
  roll: Roll,
  context: WizardRollContext & { formula: string; total: number },
): Promise<void> {
  const breakdown = parseRollBreakdown(roll, context.formula);
  const actorName = context.actor?.name ?? "";
  const hasCdDice = breakdown.cdDice.length > 0;
  const hasD20Faces = breakdown.d20Faces.length > 0;
  const hasModifier = breakdown.modifier !== 0;
  const cdEffects = breakdown.cdDice.filter((die) => isCombatDieEffectFace(die.face))
    .length;
  const cdTotal = hasCdDice ? context.total - breakdown.modifier : 0;

  const html = await foundry.applications.handlebars.renderTemplate(
    `${MODULE_PATH}/templates/chat/wizard-roll.hbs`,
    {
      actorName,
      cdDice: breakdown.cdDice,
      cdEffects,
      cdTotal,
      d20Faces: breakdown.d20Faces,
      detail: context.detail ?? "",
      formula: context.formula,
      hasActor: Boolean(actorName),
      hasCdDice,
      hasCdSummary: hasCdDice,
      hasDetail: Boolean(context.detail),
      hasD20Faces,
      hasItem: Boolean(context.itemName),
      hasModifier,
      itemName: context.itemName ?? "",
      label: context.label,
      modifier: breakdown.modifier,
      strings: {
        character: game.i18n.localize("WASTELANDER.Wizard.RollChat.Character"),
        cd: game.i18n.localize("WASTELANDER.Wizard.RollChat.Cd"),
        detail: game.i18n.localize("WASTELANDER.Wizard.RollChat.Detail"),
        effects: game.i18n.localize("WASTELANDER.Wizard.RollChat.Effects"),
        formula: game.i18n.localize("WASTELANDER.Wizard.RollChat.Formula"),
        item: game.i18n.localize("WASTELANDER.Wizard.RollChat.Item"),
        total: game.i18n.localize("WASTELANDER.Wizard.RollChat.Total"),
      },
      total: context.total,
    },
  );

  const rollMode = game.settings.get("core", "rollMode");
  const chatData: Record<string, unknown> = {
    content: html,
    rollMode,
    speaker: ChatMessage.getSpeaker({ actor: context.actor ?? undefined }),
    style: getOtherChatMessageStyle(),
    user: game.user.id,
  };

  ChatMessage.applyRollMode(chatData, rollMode);
  await ChatMessage.create(chatData);
}

/**
 * Evaluate a Foundry roll formula using the active system's dice — same as
 * chat macros (`/r 1d20`, `/r 2d20`, `/r 10+5dc`, etc.). Posts a chat card
 * when `context` is provided.
 */
export async function evaluateFalloutRoll(
  formula: string,
  context?: WizardRollContext,
): Promise<number> {
  const evaluated = await evaluateRoll(formula, { animate: true });

  if (context) {
    await postWizardRollChat(evaluated.roll, {
      ...context,
      formula: evaluated.formula,
      total: evaluated.total,
    });
  }

  return evaluated.total;
}
