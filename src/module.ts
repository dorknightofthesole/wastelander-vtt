import { MODULE_ID } from "./constants.js";
import {
  registerActorSheetControlHooks,
  registerActorSheetControls,
} from "./integrations/actorSheetControls.js";
import { registerTranslations } from "./integrations/i18n.js";

Hooks.once("init", () => {
  registerTranslations();
  registerActorSheetControlHooks();
  console.log(`${MODULE_ID} | initializing`);
});

Hooks.on("renderActorSheet", (...args: unknown[]) => {
  const [app, html] = args as [{ actor?: Actor; document?: Actor }, JQuery];
  registerActorSheetControls(app, html);
});
