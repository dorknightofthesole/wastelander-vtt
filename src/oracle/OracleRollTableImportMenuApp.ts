import { MODULE_PATH } from "../constants.js";
import {
  getBundledOracleRollTableCount,
  importBundledOracleRollTables,
  notifyOracleRollTableImportResult,
} from "./oracleRollTableImport.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;


export default class OracleRollTableImportMenuApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  #importing = false;

  static override DEFAULT_OPTIONS = {
    id: "wastelander-oracle-import",
    tag: "form",
    classes: ["wastelander-wizard", "wastelander-oracle-import-app"],
    window: {
      title: "WASTELANDER.Oracle.Import.MenuTitle",
      icon: "fa-solid fa-dice",
    },
    position: { width: 520, height: "auto" },
    actions: {
      runImport: OracleRollTableImportMenuApp.onRunImport,
    },
  };

  static override PARTS = {
    body: {
      template: `${MODULE_PATH}/templates/oracle/import-menu.hbs`,
    },
  };

  protected override async _prepareContext(): Promise<Record<string, unknown>> {
    const bundledCount = getBundledOracleRollTableCount();
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

  static async onRunImport(this: OracleRollTableImportMenuApp): Promise<void> {
    if (this.#importing) return;

    this.#importing = true;
    await this.render();

    try {
      const result = await importBundledOracleRollTables();
      notifyOracleRollTableImportResult(result);
    } finally {
      this.#importing = false;
      await this.render();
    }
  }
}
