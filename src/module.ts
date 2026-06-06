import { MODULE_ID } from "./constants.js";
import {
  registerActorSheetControlHooks,
  registerActorSheetControls,
} from "./integrations/actorSheetControls.js";
import { registerTranslations } from "./integrations/i18n.js";
import { getBundledDenizenCount, importBundledDenizens } from "./scavenging/denizenImport.js";
import { registerCombatDiceChatButton } from "./integrations/combatDiceChatButton.js";
import { registerScavengingHooks } from "./scavenging/scavengingHooks.js";

Hooks.once("init", () => {
  registerTranslations();
  registerActorSheetControlHooks();
  registerCombatDiceChatButton();
  registerScavengingHooks();
  console.log(`${MODULE_ID} | initializing`);
});

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID) as { api?: Record<string, unknown> } | undefined;
  if (!mod) return;
  mod.api = {
    importDenizens: importBundledDenizens,
    bundledDenizenCount: getBundledDenizenCount,
  };
});

Hooks.on("renderActorSheet", (...args: unknown[]) => {
  const [app, html] = args as [{ actor?: Actor; document?: Actor }, JQuery];
  registerActorSheetControls(app, html);
});
