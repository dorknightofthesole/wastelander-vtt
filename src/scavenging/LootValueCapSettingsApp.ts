import { MODULE_ID, MODULE_PATH } from "../constants.js";
import { t } from "../integrations/i18n.js";
import {
  capsForLocationLevelFromConfig,
  getBundledLootValueCapConfig,
  getDefaultLootValueCapFormula,
  normalizeLootValueCapConfig,
  recalculateBandCapsFromFormula,
  type LootValueCapBand,
  type LootValueCapConfig,
  type LootValueCapFormula,
} from "./lootValueCap.js";
import { SCAVENGING_SETTINGS } from "./scavengingSettings.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;


const PREVIEW_LEVELS = [0, 5, 10, 11, 15];

function previewRowsFromConfig(config: LootValueCapConfig): Array<{ level: number; maxCaps: number }> {
  return PREVIEW_LEVELS.map((level) => ({
    level,
    maxCaps: capsForLocationLevelFromConfig(level, config),
  }));
}

function readFormulaFromForm(root: HTMLElement): LootValueCapFormula {
  const base = Number(root.querySelector<HTMLInputElement>('[name="formulaBase"]')?.value ?? 25);
  const scale = Number(root.querySelector<HTMLInputElement>('[name="formulaScale"]')?.value ?? 30);
  const capCeiling = Number(
    root.querySelector<HTMLInputElement>('[name="formulaCapCeiling"]')?.value ?? 10_000,
  );
  return normalizeLootValueCapConfig({
    formula: {
      base: Math.max(0, Math.floor(base)),
      scale: Math.max(0, Math.floor(scale)),
      capCeiling: Math.max(0, Math.floor(capCeiling)),
    },
  }).formula!;
}

function readBandsFromForm(root: HTMLElement): LootValueCapBand[] {
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
  return bands;
}

function readConfigFromForm(root: HTMLElement): LootValueCapConfig {
  const bands = readBandsFromForm(root);
  const formula = readFormulaFromForm(root);

  return normalizeLootValueCapConfig({
    bands,
    formula,
    defaultMaxCaps: formula.capCeiling ?? 10_000,
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
    position: { width: 620, height: "auto" },
    actions: {
      addBand: LootValueCapSettingsApp.onAddBand,
      removeBand: LootValueCapSettingsApp.onRemoveBand,
      recalculateBands: LootValueCapSettingsApp.onRecalculateBands,
      saveConfig: LootValueCapSettingsApp.onSaveConfig,
      resetDefaults: LootValueCapSettingsApp.onResetDefaults,
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

    const formula = this.#config.formula ?? getDefaultLootValueCapFormula();
    const bands = this.#config.bands ?? [];
    return {
      bands,
      formulaBase: formula.base ?? 25,
      formulaScale: formula.scale ?? 30,
      formulaCapCeiling: formula.capCeiling ?? 10_000,
      previewRows: previewRowsFromConfig(this.#config),
    };
  }

  static onAddBand(this: LootValueCapSettingsApp): void {
    const bands = [...(this.#config.bands ?? [])];
    const last = bands.at(-1);
    const formula = this.#config.formula ?? getDefaultLootValueCapFormula();
    const maxLevel = (last?.maxLevel ?? 0) + 2;
    bands.push({
      maxLevel,
      maxCaps: recalculateBandCapsFromFormula([{ maxLevel, maxCaps: 0 }], formula)[0]!
        .maxCaps,
    });
    this.#config = { ...this.#config, bands };
    void this.render();
  }

  static onRemoveBand(
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

  static onRecalculateBands(
    this: LootValueCapSettingsApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const root = target.closest<HTMLElement>(".wastelander-loot-cap-settings");
    if (!root) return;

    const formula = readFormulaFromForm(root);
    const bands = readBandsFromForm(root);
    if (!bands.length) {
      ui.notifications.warn(t("WASTELANDER.Scavenging.Settings.LootValueCapNoBands"));
      return;
    }

    const recalculated = recalculateBandCapsFromFormula(bands, formula);
    this.#config = {
      ...this.#config,
      formula,
      bands: recalculated,
      defaultMaxCaps: formula.capCeiling ?? this.#config.defaultMaxCaps,
    };
    void this.render();
  }

  static async onSaveConfig(
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

  static async onResetDefaults(this: LootValueCapSettingsApp): Promise<void> {
    const defaults = getBundledLootValueCapConfig();
    await game.settings.set(MODULE_ID, SCAVENGING_SETTINGS.lootValueCapConfig, defaults);
    this.#config = defaults;
    ui.notifications.info(t("WASTELANDER.Scavenging.Settings.LootValueCapResetDone"));
    await this.render();
  }
}
