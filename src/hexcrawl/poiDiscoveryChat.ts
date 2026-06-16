import { MODULE_PATH } from "../constants.js";
import { t } from "../integrations/i18n.js";
import type { PoiDiscovery } from "./hexAnnotations.js";

export async function postPoiDiscoveredChat(discovery: PoiDiscovery): Promise<void> {
  const content = await foundry.applications.handlebars.renderTemplate(
    `${MODULE_PATH}/templates/chat/poi-discovered.hbs`,
    {
      strings: {
        body: t("WASTELANDER.Hexcrawl.PoiDiscovered.ChatBody", {
          poi: discovery.label,
          hex: discovery.hexKey,
        }),
      },
    },
  );

  await ChatMessage.create({
    content,
    style: CONST.CHAT_MESSAGE_STYLES.OTHER,
  });
}

export function notifyPoiDiscovered(discovery: PoiDiscovery): void {
  void postPoiDiscoveredChat(discovery).catch((error) => {
    console.error("wastelander | POI discovery chat failed", error);
  });
}
