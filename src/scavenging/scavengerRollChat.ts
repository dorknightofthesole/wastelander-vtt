import { t } from "../integrations/i18n.js";
import { evaluateFoundryRoll, showRollAnimation } from "../integrations/foundryRoll.js";
import { postWizardRollChat } from "../integrations/falloutRollChat.js";
import type { CombatDiceRollResult } from "./dice.js";

/** 3D dice then chat card — one roll, no double evaluation. */
export async function presentScavengerRoll(params: {
  roll: Roll;
  formula: string;
  label: string;
  total: number;
  detail?: string;
  animate?: boolean;
}): Promise<void> {
  if (params.animate === false) return;
  await showRollAnimation(params.roll);
  await postWizardRollChat(params.roll, {
    label: params.label,
    formula: params.formula,
    total: params.total,
    detail: params.detail,
  });
}

/** Post location-level CD roll to chat (CD faces + effects + final level). */
export async function postLocationLevelRollChat(params: {
  dcRoll: CombatDiceRollResult;
  level: number;
  bonusFromEffects: number;
  animate?: boolean;
}): Promise<void> {
  const roll = params.dcRoll.roll;
  if (!roll) return;

  const detail =
    params.bonusFromEffects > 0
      ? t("WASTELANDER.Scavenging.RollChat.LevelWithEffects", {
          effects: params.bonusFromEffects,
          level: params.level,
        })
      : t("WASTELANDER.Scavenging.RollChat.LevelFinal", {
          level: params.level,
        });

  await presentScavengerRoll({
    roll,
    formula: params.dcRoll.formula,
    label: t("WASTELANDER.Scavenging.RollChat.LocationLevel"),
    total: params.dcRoll.sum,
    detail,
    animate: params.animate,
  });
}

/** Present inhabitant count die (d4/d6) in chat. */
export async function postInhabitantCountRollChat(params: {
  roll: Roll;
  formula: string;
  dieFace: number;
  count: number;
  animate?: boolean;
}): Promise<void> {
  await presentScavengerRoll({
    roll: params.roll,
    formula: params.formula,
    label: t("WASTELANDER.Scavenging.RollChat.InhabitantCount"),
    total: params.dieFace,
    detail: t("WASTELANDER.Scavenging.RollChat.InhabitantCountDetail", {
      dieFace: params.dieFace,
      formula: params.formula,
      count: params.count,
    }),
    animate: params.animate,
  });
}
