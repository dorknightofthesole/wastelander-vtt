import { MODULE_PATH } from "../constants.js";
import { isWizardCreationComplete } from "./actorFlags.js";
import {
  exportActorCharacterSheet,
  notifyPdfTemplateMissing,
} from "../export/exportCharacterSheet.js";
import { importActorCharacterSheet } from "../export/importCharacterSheet.js";
import { isPdfTemplateAvailable } from "../export/pdfTemplates.js";
import CharacterWizardApp from "../wizard/CharacterWizardApp.js";
import { isFalloutWizardActor } from "./fallout.js";
import { resolveActor } from "./falloutActor.js";
import { registerTranslations, t } from "./i18n.js";

const WASTELANDER_HEADER_ACTION = "wastelander-menu";
const PORTAL_ID = "wastelander-sheet-dropdown-portal";

let exportInFlight = false;
let importInFlight = false;

function actorFromSheetApp(app: {
  actor?: Actor;
  document?: Actor;
}): Actor | undefined {
  return app.document ?? app.actor;
}

function shouldShowForActor(actor: Actor | undefined): actor is Actor {
  if (!actor || !isFalloutWizardActor(actor)) return false;
  return actor.isOwner;
}

function openBuildWizard(actor: Actor): void {
  try {
    void CharacterWizardApp.renderForActor(resolveActor(actor));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Cannot open character wizard.";
    ui.notifications.warn(message);
  }
}

async function runExport(actor: Actor): Promise<void> {
  if (exportInFlight) return;
  exportInFlight = true;
  try {
    await exportActorCharacterSheet(resolveActor(actor));
  } finally {
    exportInFlight = false;
  }
}

async function runParse(actor: Actor): Promise<void> {
  if (importInFlight) return;
  importInFlight = true;
  try {
    await importActorCharacterSheet(resolveActor(actor));
  } finally {
    importInFlight = false;
  }
}

function closePortalMenu(): void {
  document.getElementById(PORTAL_ID)?.remove();
}

function positionPortalMenu(menu: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.left = `${Math.max(8, rect.left)}px`;
  menu.style.zIndex = "10000";
}

async function openPortalMenu(anchor: HTMLElement, actor: Actor): Promise<void> {
  closePortalMenu();
  registerTranslations();

  const buildLabel = t("ActorSheet.Menu.Build");
  const exportLabel = t("ActorSheet.Menu.ExportPdf");
  const parseLabel = t("ActorSheet.Menu.ParsePdf");
  const exportAvailable = await isPdfTemplateAvailable(actor.type);
  const exportDisabledAttr = exportAvailable ? "" : " disabled";
  const exportDisabledClass = exportAvailable
    ? ""
    : " wastelander-sheet-dropdown-item--disabled";
  const parseDisabled = actor.type === "robot" ? " disabled" : "";
  const parseDisabledClass =
    actor.type === "robot" ? " wastelander-sheet-dropdown-item--disabled" : "";

  const menu = document.createElement("nav");
  menu.id = PORTAL_ID;
  menu.className = "wastelander-sheet-dropdown-portal";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" class="wastelander-sheet-dropdown-item" data-action="build" role="menuitem">
      <i class="fas fa-hammer" aria-hidden="true"></i>
      <span>${buildLabel}</span>
    </button>
    <button type="button" class="wastelander-sheet-dropdown-item${exportDisabledClass}" data-action="export-pdf" role="menuitem"${exportDisabledAttr}>
      <i class="fas fa-file-pdf" aria-hidden="true"></i>
      <span>${exportLabel}</span>
    </button>
    <button type="button" class="wastelander-sheet-dropdown-item${parseDisabledClass}" data-action="parse-pdf" role="menuitem"${parseDisabled}>
      <i class="fas fa-file-upload" aria-hidden="true"></i>
      <span>${parseLabel}</span>
    </button>
  `;

  menu.addEventListener("click", (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>(
      "[data-action]",
    );
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    closePortalMenu();
    const action = target.dataset.action;
    if (action === "build") {
      if (
        target.hasAttribute("disabled") ||
        target.classList.contains("wastelander-sheet-dropdown-item--disabled")
      ) {
        ui.notifications.info(t("ActorSheet.Menu.BuildComplete"));
        return;
      }
      openBuildWizard(actor);
      return;
    }
    if (action === "export-pdf") {
      if (
        target.hasAttribute("disabled") ||
        target.classList.contains("wastelander-sheet-dropdown-item--disabled")
      ) {
        notifyPdfTemplateMissing(actor.type);
        return;
      }
      void runExport(actor);
      return;
    }
    if (action === "parse-pdf") {
      if (actor.type === "robot") {
        ui.notifications.warn(t("ActorSheet.Import.RobotNotSupported"));
        return;
      }
      void runParse(actor);
    }
  });

  document.body.appendChild(menu);
  positionPortalMenu(menu, anchor);
}

function togglePortalMenu(anchor: HTMLElement, actor: Actor): void {
  const open = document.getElementById(PORTAL_ID);
  if (open) {
    closePortalMenu();
    return;
  }
  void openPortalMenu(anchor, actor);
}

function bindGlobalPortalClose(): void {
  const flag = "__wastelanderPortalCloseBound";
  if ((globalThis as Record<string, unknown>)[flag]) return;
  (globalThis as Record<string, unknown>)[flag] = true;

  document.addEventListener("click", (event) => {
    const portal = document.getElementById(PORTAL_ID);
    if (!portal) return;
    const target = event.target;
    if (target instanceof Element) {
      if (portal.contains(target)) return;
      if (target.closest(`[data-action="${WASTELANDER_HEADER_ACTION}"]`)) {
        return;
      }
    }
    closePortalMenu();
  });

  window.addEventListener("resize", closePortalMenu);
}

function wastelanderMenuHandler(
  event: Event,
  anchor: HTMLElement,
  actor: Actor,
): void {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  togglePortalMenu(anchor, actor);
}

function wireHeaderButton(anchor: JQuery, actor: Actor): void {
  if (anchor.data("wastelander-wired")) return;
  anchor.data("wastelander-wired", true);

  const element = anchor[0];
  if (!element) return;

  const handler = (event: Event) => {
    wastelanderMenuHandler(event, element, actor);
  };

  element.addEventListener("click", handler, true);
}

function wastelanderHeaderIcon(): string {
  const iconSrc = `${MODULE_PATH}/assets/origins/vault-dweller.png`;
  return `<img class="wastelander-launch-icon" src="${iconSrc}" alt="" width="18" height="18" />`;
}

function pushWastelanderHeaderControl(
  app: { actor?: Actor; document?: Actor },
  controls: Array<Record<string, unknown>>,
): void {
  const actor = actorFromSheetApp(app);
  if (!shouldShowForActor(actor)) return;

  if (controls.some((c) => c.action === WASTELANDER_HEADER_ACTION)) return;

  registerTranslations();

  const label = t("ModuleTitle");
  const icon = wastelanderHeaderIcon();

  const onMenuClick = (event: Event) => {
    const target = (event.currentTarget ?? event.target) as HTMLElement | null;
    if (!target) return;
    wastelanderMenuHandler(event, target, actor);
  };

  controls.push({
    action: WASTELANDER_HEADER_ACTION,
    icon,
    label,
    ownership: "OWNER",
    onClick: onMenuClick,
    onClickAction: onMenuClick,
  });
}

export function registerActorSheetControlHooks(): void {
  bindGlobalPortalClose();

  Hooks.on(
    "getHeaderControlsActorSheetV2",
    (app: { actor?: Actor; document?: Actor }, controls: Array<Record<string, unknown>>) => {
      pushWastelanderHeaderControl(app, controls);
    },
  );

  Hooks.on(
    "getHeaderControlsApplicationV2",
    (app: { actor?: Actor; document?: Actor }, controls: Array<Record<string, unknown>>) => {
      pushWastelanderHeaderControl(app, controls);
    },
  );
}

/** Wire click handler after sheet render (AppV2 header controls + v1 fallback). */
export function registerActorSheetControls(
  app: { actor?: Actor; document?: Actor },
  html: JQuery | HTMLElement,
): void {
  const actor = actorFromSheetApp(app);
  if (!shouldShowForActor(actor)) return;

  bindGlobalPortalClose();

  const $html = html instanceof jQuery ? html : $(html);

  const v2Button = $html.find(`[data-action="${WASTELANDER_HEADER_ACTION}"]`);
  if (v2Button.length) {
    wireHeaderButton(v2Button, actor);
    return;
  }

  if ($html.find(".wastelander-sheet-menu-wrap").length) return;

  registerTranslations();
  const label = t("ModuleTitle");
  const icon = wastelanderHeaderIcon();

  const wrap = $(`
    <div class="wastelander-sheet-menu-wrap">
      <a class="wastelander-sheet-menu-trigger" href="#" aria-haspopup="menu">
        ${icon}
        <span class="wastelander-sheet-menu-label">${label}</span>
      </a>
    </div>
  `);

  const header = $html.find(".window-header");
  const sheetHeader = header.length ? header : $html.find(".sheet-header");
  const trigger = wrap.find(".wastelander-sheet-menu-trigger");
  wireHeaderButton(trigger, actor);

  if (header.length) {
    const closeBtn = header
      .find('button[data-action="close"], a.close, .header-button.close')
      .first();
    if (closeBtn.length) closeBtn.before(wrap);
    else header.append(wrap);
  } else {
    sheetHeader.prepend(wrap);
  }
}
