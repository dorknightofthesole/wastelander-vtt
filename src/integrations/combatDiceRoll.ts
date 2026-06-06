import { rollCombatDice } from "../scavenging/dice.js";
import { t } from "./i18n.js";
import { showRollAnimation } from "./foundryRoll.js";
import { postWizardRollChat } from "./falloutRollChat.js";

export const MIN_COMBAT_DICE = 1;
export const MAX_COMBAT_DICE = 100;

/** Fallout chat asset for a combat die effect face (used for the chat roll button). */
export const FALLOUT_CD_EFFECT_ICON = "systems/fallout/assets/chat/d6.webp";

/** Parse a combat dice count; returns null when not an integer from 1–100. */
export function normalizeCombatDiceCount(raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  const count = Math.floor(raw);
  if (count < MIN_COMBAT_DICE || count > MAX_COMBAT_DICE) return null;
  return count;
}

/** @deprecated Use {@link normalizeCombatDiceCount}. */
export function clampCombatDiceCount(count: number): number {
  return normalizeCombatDiceCount(count) ?? MIN_COMBAT_DICE;
}

/** Selected token (single), else assigned character. */
export function getCombatDiceSpeakerActor(): Actor | null {
  const controlled = canvas.tokens?.controlled ?? [];
  if (controlled.length === 1) {
    return controlled[0]?.actor ?? null;
  }
  return game.user?.character ?? null;
}

export async function rollAndPostCombatDice(params: {
  count: number;
  rollLabel?: string;
  actor?: Actor | null;
}): Promise<boolean> {
  const count = normalizeCombatDiceCount(params.count);
  if (count === null) {
    ui.notifications.warn(t("WASTELANDER.CombatDiceRoll.InvalidCount"));
    return false;
  }

  const result = await rollCombatDice(count, { animate: false });
  const roll = result.roll;
  if (!roll) {
    ui.notifications.error(t("WASTELANDER.CombatDiceRoll.RollFailed"));
    return false;
  }

  const label = params.rollLabel?.trim() || t("WASTELANDER.CombatDiceRoll.DefaultLabel");

  await showRollAnimation(roll);
  await postWizardRollChat(roll, {
    actor: params.actor ?? undefined,
    label,
    formula: result.formula,
    total: result.sum,
    plainCdSummary: true,
  });

  return true;
}
