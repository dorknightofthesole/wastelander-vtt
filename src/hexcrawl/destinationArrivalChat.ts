import { MODULE_PATH } from "../constants.js";
import { t } from "../integrations/i18n.js";
import type { MapDestinationArrival } from "./hexMapDestination.js";

export async function postDestinationArrivedChat(arrival: MapDestinationArrival): Promise<void> {
  const content = await foundry.applications.handlebars.renderTemplate(
    `${MODULE_PATH}/templates/chat/destination-arrived.hbs`,
    {
      strings: {
        body: t("WASTELANDER.Hexcrawl.DestinationArrived.ChatBody", {
          destination: arrival.name,
          hex: arrival.hexKey,
        }),
      },
    },
  );

  await ChatMessage.create({
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });
}

export function notifyDestinationArrived(arrival: MapDestinationArrival): void {
  void postDestinationArrivedChat(arrival).catch((error) => {
    console.error("wastelander | destination arrival chat failed", error);
  });
}
