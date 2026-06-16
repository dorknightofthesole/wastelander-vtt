import { MODULE_PATH } from "../constants.js";
import { currentUserIsOverseer } from "../integrations/overseerAccess.js";
import {
  getBundledDenizenCount,
  importBundledDenizens,
  notifyDenizenImportResult,
} from "./denizenImport.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;


export default class DenizenImportMenuApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  #importing = false;

  static override DEFAULT_OPTIONS = {
    id: "wastelander-denizen-import",
    tag: "form",
    classes: ["wastelander-wizard", "wastelander-denizen-import-app"],
    window: {
      title: "WASTELANDER.Denizens.Import.MenuTitle",
      icon: "fa-solid fa-file-import",
    },
    position: { width: 520, height: "auto" },
    actions: {
      runImport: DenizenImportMenuApp.onRunImport,
    },
  };

  static override PARTS = {
    body: {
      template: `${MODULE_PATH}/templates/denizens/import-menu.hbs`,
    },
  };

  protected override async _prepareContext(): Promise<Record<string, unknown>> {
    const bundledCount = getBundledDenizenCount();
    const canImport =
      game.system.id === "fallout" &&
      currentUserIsOverseer() &&
      bundledCount > 0 &&
      !this.#importing;

    return {
      falloutSystem: game.system.id === "fallout",
      hasBundled: bundledCount > 0,
      bundledCount,
      isGm: currentUserIsOverseer(),
      importing: this.#importing,
      canImport,
    };
  }

  static async onRunImport(this: DenizenImportMenuApp): Promise<void> {
    if (this.#importing) return;

    this.#importing = true;
    await this.render();

    try {
      const result = await importBundledDenizens();
      notifyDenizenImportResult(result);
    } finally {
      this.#importing = false;
      await this.render();
    }
  }
}

export function renderDenizenImportMenu(): void {
  const app = new DenizenImportMenuApp();
  void app.render({ force: true });
}
