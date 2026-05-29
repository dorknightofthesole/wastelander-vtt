import { MODULE_ID, MODULE_PATH } from "./constants.js";
import CharacterWizardApp from "./wizard/CharacterWizardApp.js";
import { isFalloutWizardActor } from "./integrations/fallout.js";
import { resolveActor } from "./integrations/falloutActor.js";
import { registerTranslations, t } from "./integrations/i18n.js";

Hooks.once("init", () => {
  registerTranslations();
  console.log(`${MODULE_ID} | initializing`);
});

Hooks.on("renderActorSheet", (app: { actor?: Actor; document?: Actor }, html: JQuery) => {
  const actor = app.document ?? app.actor;
  if (!actor || !isFalloutWizardActor(actor)) return;
  if (!actor.isOwner) return;
  if (actor.getFlag(MODULE_ID, "creationComplete")) return;

  registerTranslations();
  const label = t("ModuleTitle");
  const iconSrc = `${MODULE_PATH}/assets/origins/vault-dweller.png`;

  const $html = html instanceof jQuery ? html : $(html);
  const header = $html.find(".window-header");
  const sheetHeader = header.length ? header : $html.find(".sheet-header");
  if (sheetHeader.find(".wastelander-launch-wizard").length) return;

  const button = $(`
    <a class="header-button wastelander-launch-wizard" data-tooltip="${label}">
      <img class="wastelander-launch-icon" src="${iconSrc}" alt="" width="18" height="18" />
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

  if (header.length) {
    const closeBtn = header
      .find('button[data-action="close"], a.close, .header-button.close')
      .first();
    if (closeBtn.length) closeBtn.before(button);
    else header.append(button);
  } else {
    sheetHeader.prepend(button);
  }
});
