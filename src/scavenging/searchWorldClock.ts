import { MODULE_PATH } from "../constants.js";
import { t } from "../integrations/i18n.js";
import {
  advanceWorldClockMinutes,
  type WorldClockAdvanceResult,
} from "../integrations/worldClock.js";
import type { ScavengerLocation } from "./ScavengerLocation.js";
import type { ScavengerPlayerSearchState } from "./playerSearchState.js";
import {
  getScavengingSettingBoolean,
  SCAVENGING_SETTINGS,
} from "./scavengingSettings.js";

function getOtherChatMessageStyle(): number {
  const styles = (globalThis as { fallout?: { utils?: { getMessageStyles?: () => { OTHER: number } } } })
    .fallout?.utils?.getMessageStyles?.();
  if (styles?.OTHER !== undefined) return styles.OTHER;
  return CONST.CHAT_MESSAGE_STYLES.OTHER;
}

/** Human-readable duration for chat (e.g. 90 → "1 hour 30 minutes"). */
export function formatSearchDuration(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  if (total < 60) {
    return t("WASTELANDER.Scavenging.WorldClock.DurationMinutes", { minutes: total });
  }
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  if (remainder === 0) {
    return t("WASTELANDER.Scavenging.WorldClock.DurationHours", { hours });
  }
  return t("WASTELANDER.Scavenging.WorldClock.DurationHoursMinutes", {
    hours,
    minutes: remainder,
  });
}

async function postSearchTimeChat(params: {
  locationName: string;
  durationLabel: string;
  clockLabel?: string;
}): Promise<void> {
  const content = await foundry.applications.handlebars.renderTemplate(
    `${MODULE_PATH}/templates/chat/search-time-advanced.hbs`,
    {
      durationLabel: params.durationLabel,
      locationName: params.locationName,
      clockLabel: params.clockLabel ?? "",
      strings: {
        body: t("WASTELANDER.Scavenging.WorldClock.ChatBody", {
          duration: params.durationLabel,
          location: params.locationName,
        }),
        clock: params.clockLabel
          ? t("WASTELANDER.Scavenging.WorldClock.ChatClock", {
              clock: params.clockLabel,
            })
          : "",
      },
    },
  );

  await ChatMessage.create({
    content,
    style: getOtherChatMessageStyle(),
  });
}

function notifyAdvanceResult(
  location: ScavengerLocation,
  result: WorldClockAdvanceResult,
): void {
  if (!result.advanced) return;
  const durationLabel = formatSearchDuration(result.minutes);
  void postSearchTimeChat({
    locationName: location.name,
    durationLabel,
    clockLabel: result.clockLabel,
  });
  ui.notifications.info(
    t("WASTELANDER.Scavenging.WorldClock.Advanced", {
      duration: durationLabel,
      location: location.name,
    }),
  );
}

/**
 * Advance the world clock once per search attempt, using the location's Time Taken.
 */
export async function applySearchTimeToWorldClock(
  location: ScavengerLocation,
  playerSearch: ScavengerPlayerSearchState,
  options?: { alreadyAdvanced?: boolean },
): Promise<ScavengerPlayerSearchState> {
  if (playerSearch.searchTimeAdvanced || options?.alreadyAdvanced) {
    return { ...playerSearch, searchTimeAdvanced: true };
  }

  if (!getScavengingSettingBoolean(SCAVENGING_SETTINGS.advanceWorldClockOnSearch)) {
    return playerSearch;
  }

  const result = advanceWorldClockMinutes(location.searchMinutes);
  if (result.ok && result.advanced) {
    notifyAdvanceResult(location, result);
    return { ...playerSearch, searchTimeAdvanced: true };
  }

  if (!result.ok) {
    ui.notifications.warn(
      t("WASTELANDER.Scavenging.WorldClock.Failed", {
        error: result.error,
      }),
    );
  }

  return playerSearch;
}
