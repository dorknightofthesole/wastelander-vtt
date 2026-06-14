import { MODULE_PATH } from "../constants.js";
import { t } from "../integrations/i18n.js";
import {
  advanceWorldClockMinutes,
  type WorldClockAdvanceResult,
} from "../integrations/worldClock.js";
import { formatSearchDuration } from "../scavenging/searchWorldClock.js";
import { getHexcrawlSettingBoolean, HEXCRAWL_SETTINGS } from "./hexcrawlSettings.js";

async function postTravelTimeChat(params: {
  sceneName: string;
  durationLabel: string;
  hexKey: string;
  clockLabel?: string;
}): Promise<void> {
  const content = await foundry.applications.handlebars.renderTemplate(
    `${MODULE_PATH}/templates/chat/travel-time-advanced.hbs`,
    {
      durationLabel: params.durationLabel,
      sceneName: params.sceneName,
      hexKey: params.hexKey,
      clockLabel: params.clockLabel ?? "",
      strings: {
        body: t("WASTELANDER.Hexcrawl.WorldClock.ChatBody", {
          duration: params.durationLabel,
          hex: params.hexKey,
          scene: params.sceneName,
        }),
        clock: params.clockLabel
          ? t("WASTELANDER.Hexcrawl.WorldClock.ChatClock", {
              clock: params.clockLabel,
            })
          : "",
      },
    },
  );

  await ChatMessage.create({
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });
}

export async function applyHexTravelToWorldClock(params: {
  sceneName: string;
  hexKey: string;
  minutes: number;
}): Promise<WorldClockAdvanceResult> {
  if (!getHexcrawlSettingBoolean(HEXCRAWL_SETTINGS.advanceWorldClockOnTravel)) {
    return { advanced: false, reason: "disabled" };
  }

  const result = advanceWorldClockMinutes(params.minutes);
  if (result.ok && result.advanced) {
    const durationLabel = formatSearchDuration(result.minutes);
    await postTravelTimeChat({
      sceneName: params.sceneName,
      hexKey: params.hexKey,
      durationLabel,
      clockLabel: result.clockLabel,
    });
  } else if (!result.ok && result.error) {
    ui.notifications.warn(
      t("WASTELANDER.Hexcrawl.WorldClock.Failed", { error: result.error }),
    );
  }

  return result;
}
