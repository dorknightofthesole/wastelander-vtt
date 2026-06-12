import { t } from "../integrations/i18n.js";
import { currentUserIsOverseer } from "../integrations/overseerAccess.js";
import { renderDenizenImportMenu } from "./DenizenImportMenuApp.js";

type SidebarHeaderControl = Record<string, unknown>;

function isActorsSidebar(app: unknown): boolean {
  if (!app || typeof app !== "object") return false;
  const tab = app as { tabName?: string; id?: string; collection?: string };
  const name = tab.tabName ?? tab.id ?? tab.collection ?? "";
  return String(name).toLowerCase() === "actors";
}

function pushDenizenImportHeaderControl(controls: SidebarHeaderControl[]): void {
  if (!currentUserIsOverseer()) return;
  if (controls.some((c) => c.action === "wastelanderImportDenizens")) return;

  controls.push({
    action: "wastelanderImportDenizens",
    icon: "fa-solid fa-file-import",
    label: t("WASTELANDER.Denizens.Import.OpenMenu"),
    visible: () => currentUserIsOverseer(),
    onClick: () => renderDenizenImportMenu(),
  });
}

export function registerDenizenImportHooks(): void {
  const hooks = [
    "getHeaderControlsAbstractSidebarTab",
    "getHeaderControlsActorDirectory",
  ] as const;

  for (const hookName of hooks) {
    Hooks.on(hookName, (app: unknown, controls: SidebarHeaderControl[]) => {
      if (!isActorsSidebar(app)) return;
      pushDenizenImportHeaderControl(controls);
    });
  }
}
