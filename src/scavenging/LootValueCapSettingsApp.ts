import { MODULE_ID, MODULE_PATH } from "../constants.js";
import { t } from "../integrations/i18n.js";
import {
  getBundledLootValueCapConfig,
  normalizeLootValueCapConfig,
  type LootValueCapBand,
  type LootValueCapConfig,
} from "./lootValueCap.js";
import { SCAVENGING_SETTINGS } from "./scavengingSettings.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const PREVIEW_LEVELS = [0, 5, 10, 11, 15];

function previewRowsFromBands(bands: LootValueCapBand[]): Array<{ level: number; maxCaps: number }> {
  const config: LootValueCapConfig = {
    bands,
    defaultMaxCaps: bands.at(-1)?.maxCaps ?? 10000,
    drawRerollMaxAttempts: 8,
  };
  return PREVIEW_LEVELS.map((level) => ({
    level,
    maxCaps: capsForLevel(level, config),
  }));
}

function capsForLevel(level: number, config: LootValueCapConfig): number {
  const bands = config.bands ?? [];
  const lvl = Math.max(0, Math.floor(level));
  for (const band of bands) {
    if (lvl <= band.maxLevel) return band.maxCaps;
  }
  return config.defaultMaxCaps ?? bands.at(-1)?.maxCaps ?? 9999;
}

function readConfigFromForm(root: HTMLElement): LootValueCapConfig {
  const bands: LootValueCapBand[] = [];
  const rows = root.querySelectorAll<HTMLTableRowElement>("tbody tr[data-band-index]");
  for (const row of rows) {
    const maxLevel = Number(
      row.querySelector<HTMLInputElement>('[data-field="maxLevel"]')?.value ?? 0,
    );
    const maxCaps = Number(
      row.querySelector<HTMLInputElement>('[data-field="maxCaps"]')?.value ?? 0,
    );
    bands.push({
      maxLevel: Math.max(0, Math.floor(maxLevel)),
      maxCaps: Math.max(0, Math.floor(maxCaps)),
    });
  }
  bands.sort((a, b) => a.maxLevel - b.maxLevel);

  const defaultMaxCaps = Number(
    root.querySelector<HTMLInputElement>('[name="defaultMaxCaps"]')?.value ?? 0,
  );
  const drawRerollMaxAttempts = Number(
    root.querySelector<HTMLInputElement>('[name="drawRerollMaxAttempts"]')?.value ?? 8,
  );

  return normalizeLootValueCapConfig({
    bands,
    defaultMaxCaps,
    drawRerollMaxAttempts,
  });
}

export default class LootValueCapSettingsApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  #config: LootValueCapConfig = getBundledLootValueCapConfig();
  #loadedFromSettings = false;

  static override DEFAULT_OPTIONS = {
    id: "wastelander-loot-value-cap-settings",
    tag: "form",
    classes: ["wastelander-wizard", "wastelander-loot-cap-settings-app"],
    window: {
      title: "WASTELANDER.Scavenging.Settings.LootValueCapMenuTitle",
      icon: "fa-solid fa-coins",
    },
    position: { width: 560, height: 680 },
    actions: {
      addBand: LootValueCapSettingsApp.#onAddBand,
      removeBand: LootValueCapSettingsApp.#onRemoveBand,
      saveConfig: LootValueCapSettingsApp.#onSaveConfig,
      resetDefaults: LootValueCapSettingsApp.#onResetDefaults,
    },
  };

  static override PARTS = {
    body: {
      template: `${MODULE_PATH}/templates/scavenging/loot-value-cap-settings.hbs`,
    },
  };

  protected override async _prepareContext(): Promise<Record<string, unknown>> {
    if (!this.#loadedFromSettings) {
      const stored = game.settings.get(MODULE_ID, SCAVENGING_SETTINGS.lootValueCapConfig);
      const hasBands =
        stored &&
        typeof stored === "object" &&
        Array.isArray((stored as LootValueCapConfig).bands) &&
        (stored as LootValueCapConfig).bands!.length > 0;
      this.#config = hasBands
        ? normalizeLootValueCapConfig(stored)
        : getBundledLootValueCapConfig();
      this.#loadedFromSettings = true;
    }

    const bands = this.#config.bands ?? [];
    return {
      bands,
      defaultMaxCaps: this.#config.defaultMaxCaps ?? 10000,
      drawRerollMaxAttempts: this.#config.drawRerollMaxAttempts ?? 8,
      previewRows: previewRowsFromBands(bands),
    };
  }

  static #onAddBand(this: LootValueCapSettingsApp): void {
    const bands = [...(this.#config.bands ?? [])];
    const last = bands.at(-1);
    bands.push({
      maxLevel: (last?.maxLevel ?? 0) + 2,
      maxCaps: (last?.maxCaps ?? 100) + 100,
    });
    this.#config = { ...this.#config, bands };
    void this.render();
  }

  static #onRemoveBand(
    this: LootValueCapSettingsApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const index = Number(target.closest<HTMLElement>("[data-band-index]")?.dataset.bandIndex);
    if (!Number.isFinite(index)) return;
    const bands = [...(this.#config.bands ?? [])];
    bands.splice(index, 1);
    this.#config = { ...this.#config, bands };
    void this.render();
  }

  static async #onSaveConfig(
    this: LootValueCapSettingsApp,
    _event: Event,
    target: HTMLElement,
  ): Promise<void> {
    const root = target.closest<HTMLElement>(".wastelander-loot-cap-settings");
    if (!root) return;

    const config = readConfigFromForm(root);
    if (!config.bands?.length) {
      ui.notifications.warn(t("WASTELANDER.Scavenging.Settings.LootValueCapNoBands"));
      return;
    }

    await game.settings.set(MODULE_ID, SCAVENGING_SETTINGS.lootValueCapConfig, config);
    this.#config = config;
    ui.notifications.info(t("WASTELANDER.Scavenging.Settings.LootValueCapSaved"));
    await this.render();
  }

  static async #onResetDefaults(this: LootValueCapSettingsApp): Promise<void> {
    const defaults = getBundledLootValueCapConfig();
    await game.settings.set(MODULE_ID, SCAVENGING_SETTINGS.lootValueCapConfig, defaults);
    this.#config = defaults;
    ui.notifications.info(t("WASTELANDER.Scavenging.Settings.LootValueCapResetDone"));
    await this.render();
  }
}
