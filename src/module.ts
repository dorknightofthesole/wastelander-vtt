import { MODULE_ID } from "./constants.js";
import CharacterWizardApp from "./wizard/CharacterWizardApp.js";
import { isFalloutPlayerCharacter } from "./integrations/fallout.js";
import { resolveActor } from "./integrations/falloutActor.js";

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | initializing`);
});

Hooks.on("renderActorSheet", (app: { actor?: Actor; document?: Actor }, html: JQuery) => {
  const actor = app.document ?? app.actor;
  if (!actor || !isFalloutPlayerCharacter(actor)) return;
  if (!actor.isOwner) return;
  if (actor.getFlag(MODULE_ID, "creationComplete")) return;

  const label = game.i18n.localize("Wastelander");
  const button = $(`
    <a class="header-button wastelander-launch-wizard" data-tooltip="${label}">
      <i class="fa-solid fa-user-astronaut in-header"></i>
      <span>${label}</span>
    </a>
  `);

  button.on("click", (event) => {
    event.preventDefault();
    try {
      void CharacterWizardApp.renderForActor(resolveActor(actor));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Cannot open character wizard.";
      ui.notifications.warn(message);
    }
  });

  const $html = html instanceof jQuery ? html : $(html);
  const header = $html.find(".window-header");
  if (header.length) {
    const closeBtn = header
      .find('button[data-action="close"], a.close, .header-button.close')
      .first();
    if (closeBtn.length) closeBtn.before(button);
    else header.append(button);
  } else {
    $html.find(".sheet-header").prepend(button);
  }
});
