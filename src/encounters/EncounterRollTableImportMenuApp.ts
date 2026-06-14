import { MODULE_PATH } from "../constants.js";
import {
  getBundledEncounterRollTableCount,
  importBundledEncounterRollTables,
  notifyEncounterRollTableImportResult,
} from "./encounterRollTableImport.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export default class EncounterRollTableImportMenuApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  #importing = false;

  static override DEFAULT_OPTIONS = {
    id: "wastelander-encounter-import",
    tag: "form",
    classes: ["wastelander-wizard", "wastelander-oracle-import-app"],
    window: {
      title: "WASTELANDER.Encounters.Import.MenuTitle",
      icon: "fa-solid fa-map",
    },
    position: { width: 520, height: "auto" },
    actions: {
      runImport: EncounterRollTableImportMenuApp.#onRunImport,
    },
  };

  static override PARTS = {
    body: {
      template: `${MODULE_PATH}/templates/encounters/import-menu.hbs`,
    },
  };

  protected override async _prepareContext(): Promise<Record<string, unknown>> {
    const bundledCount = getBundledEncounterRollTableCount();
    const canImport =
      game.system.id === "fallout" &&
      Boolean(game.user?.isGM) &&
      bundledCount > 0 &&
      !this.#importing;

    return {
      falloutSystem: game.system.id === "fallout",
      hasBundled: bundledCount > 0,
      bundledCount,
      isGm: Boolean(game.user?.isGM),
      importing: this.#importing,
      canImport,
    };
  }

  static async #onRunImport(this: EncounterRollTableImportMenuApp): Promise<void> {
    if (this.#importing) return;
    this.#importing = true;
    await this.render();
    try {
      const result = await importBundledEncounterRollTables();
      notifyEncounterRollTableImportResult(result);
    } finally {
      this.#importing = false;
      await this.render();
    }
  }
}
