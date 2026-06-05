import { MODULE_PATH } from "../constants.js";
import { t } from "../integrations/i18n.js";
import { evaluateFoundryRoll, showRollAnimation } from "../integrations/foundryRoll.js";
import { postWizardRollChat } from "../integrations/falloutRollChat.js";
import type { CombatDiceRollResult } from "./dice.js";
import { getScavengingSettingBoolean, SCAVENGING_SETTINGS } from "./scavengingSettings.js";

function getOtherChatMessageStyle(): number {
  const styles = (globalThis as { fallout?: { utils?: { getMessageStyles?: () => { OTHER: number } } } })
    .fallout?.utils?.getMessageStyles?.();
  if (styles?.OTHER !== undefined) return styles.OTHER;
  return CONST.CHAT_MESSAGE_STYLES.OTHER;
}

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

/** Chat card when a player spends luck to improve a loot table result. */
export async function postLuckLootFindChat(params: {
  actor: Actor;
  luckSpent: number;
  itemLabel: string;
  categoryLabel?: string;
  rollSum?: number;
}): Promise<void> {
  const actorName = params.actor.name ?? "";
  const message = t("WASTELANDER.Scavenging.PlayerSearch.LuckFindChat", {
    actor: actorName,
    luck: params.luckSpent,
    item: params.itemLabel,
  });

  const html = await foundry.applications.handlebars.renderTemplate(
    `${MODULE_PATH}/templates/chat/luck-loot-find.hbs`,
    {
      label: t("WASTELANDER.Scavenging.PlayerSearch.LuckFindChatTitle"),
      message,
      hasCategory: Boolean(params.categoryLabel),
      categoryLabel: params.categoryLabel ?? "",
      hasRollSum: params.rollSum !== undefined,
      rollSum: params.rollSum ?? 0,
      strings: {
        category: game.i18n.localize("WASTELANDER.Scavenging.Fields.Category"),
        rollSum: game.i18n.localize("WASTELANDER.Scavenging.PlayerSearch.RollSum"),
      },
    },
  );

  const whisper = getScavengingSettingBoolean(SCAVENGING_SETTINGS.searchRollWhisper);
  const rollMode = whisper
    ? CONST.DICE_ROLL_MODES.PRIVATE
    : game.settings.get("core", "rollMode");

  const chatData: Record<string, unknown> = {
    content: html,
    rollMode,
    speaker: ChatMessage.getSpeaker({ actor: params.actor }),
    style: getOtherChatMessageStyle(),
    user: game.user?.id,
  };

  ChatMessage.applyRollMode(chatData, rollMode);
  await ChatMessage.create(chatData);
}
