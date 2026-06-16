import { MODULE_ID, MODULE_PATH } from "../constants.js";
import { t } from "../integrations/i18n.js";
import {
  getBundledLootRarityConfig,
  getDefaultLootRarityFormula,
  normalizeLootRarityConfig,
  rarityForLocationLevelFromConfig,
  recalculateBandRaritiesFromFormula,
  type LootRarityBand,
  type LootRarityConfig,
  type LootRarityFormula,
} from "./lootRarity.js";
import { SCAVENGING_SETTINGS } from "./scavengingSettings.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;


const PREVIEW_LEVELS = [0, 5, 10, 11, 15];

function previewRowsFromConfig(
  config: LootRarityConfig,
): Array<{ level: number; maxRarity: number }> {
  return PREVIEW_LEVELS.map((level) => ({
    level,
    maxRarity: rarityForLocationLevelFromConfig(level, config),
  }));
}

function readFormulaFromForm(root: HTMLElement): LootRarityFormula {
  const perLevel = Number(
    root.querySelector<HTMLInputElement>('[name="formulaPerLevel"]')?.value ?? 0.4,
  );
  const maxRarity = Number(
    root.querySelector<HTMLInputElement>('[name="formulaMaxRarity"]')?.value ?? 6,
  );
  return normalizeLootRarityConfig({
    formula: {
      perLevel: Math.max(0, perLevel),
      maxRarity: Math.max(0, Math.floor(maxRarity)),
    },
  }).formula!;
}

function readBandsFromForm(root: HTMLElement): LootRarityBand[] {
  const bands: LootRarityBand[] = [];
  const rows = root.querySelectorAll<HTMLTableRowElement>("tbody tr[data-band-index]");
  for (const row of rows) {
    const maxLevel = Number(
      row.querySelector<HTMLInputElement>('[data-field="maxLevel"]')?.value ?? 0,
    );
    const maxRarity = Number(
      row.querySelector<HTMLInputElement>('[data-field="maxRarity"]')?.value ?? 0,
    );
    bands.push({
      maxLevel: Math.max(0, Math.floor(maxLevel)),
      maxRarity: Math.max(0, Math.floor(maxRarity)),
    });
  }
  bands.sort((a, b) => a.maxLevel - b.maxLevel);
  return bands;
}

function readConfigFromForm(root: HTMLElement): LootRarityConfig {
  const bands = readBandsFromForm(root);
  const formula = readFormulaFromForm(root);

  return normalizeLootRarityConfig({
    bands,
    formula,
    defaultMaxRarity: formula.maxRarity ?? 6,
  });
}

export default class LootRaritySettingsApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  #config: LootRarityConfig = getBundledLootRarityConfig();
  #loadedFromSettings = false;

  static override DEFAULT_OPTIONS = {
    id: "wastelander-loot-rarity-settings",
    tag: "form",
    classes: ["wastelander-wizard", "wastelander-loot-cap-settings-app"],
    window: {
      title: "WASTELANDER.Scavenging.Settings.LootRarityMenuTitle",
      icon: "fa-solid fa-gem",
    },
    position: { width: 620, height: "auto" },
    actions: {
      addBand: LootRaritySettingsApp.onAddBand,
      removeBand: LootRaritySettingsApp.onRemoveBand,
      recalculateBands: LootRaritySettingsApp.onRecalculateBands,
      saveConfig: LootRaritySettingsApp.onSaveConfig,
      resetDefaults: LootRaritySettingsApp.onResetDefaults,
    },
  };

  static override PARTS = {
    body: {
      template: `${MODULE_PATH}/templates/scavenging/loot-rarity-settings.hbs`,
    },
  };

  protected override async _prepareContext(): Promise<Record<string, unknown>> {
    if (!this.#loadedFromSettings) {
      const stored = game.settings.get(MODULE_ID, SCAVENGING_SETTINGS.lootRarityConfig);
      const hasBands =
        stored &&
        typeof stored === "object" &&
        Array.isArray((stored as LootRarityConfig).bands) &&
        (stored as LootRarityConfig).bands!.length > 0;
      this.#config = hasBands
        ? normalizeLootRarityConfig(stored)
        : getBundledLootRarityConfig();
      this.#loadedFromSettings = true;
    }

    const formula = this.#config.formula ?? getDefaultLootRarityFormula();
    const bands = this.#config.bands ?? [];
    return {
      bands,
      formulaPerLevel: formula.perLevel ?? 0.4,
      formulaMaxRarity: formula.maxRarity ?? 6,
      previewRows: previewRowsFromConfig(this.#config),
    };
  }

  static onAddBand(this: LootRaritySettingsApp): void {
    const bands = [...(this.#config.bands ?? [])];
    const last = bands.at(-1);
    const formula = this.#config.formula ?? getDefaultLootRarityFormula();
    const maxLevel = (last?.maxLevel ?? 0) + 2;
    bands.push({
      maxLevel,
      maxRarity: recalculateBandRaritiesFromFormula(
        [{ maxLevel, maxRarity: 0 }],
        formula,
      )[0]!.maxRarity,
    });
    this.#config = { ...this.#config, bands };
    void this.render();
  }

  static onRemoveBand(
    this: LootRaritySettingsApp,
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
    this: LootRaritySettingsApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    const root = target.closest<HTMLElement>(".wastelander-loot-cap-settings");
    if (!root) return;

    const formula = readFormulaFromForm(root);
    const bands = readBandsFromForm(root);
    if (!bands.length) {
      ui.notifications.warn(t("WASTELANDER.Scavenging.Settings.LootRarityNoBands"));
      return;
    }

    const recalculated = recalculateBandRaritiesFromFormula(bands, formula);
    this.#config = {
      ...this.#config,
      formula,
      bands: recalculated,
      defaultMaxRarity: formula.maxRarity ?? this.#config.defaultMaxRarity,
    };
    void this.render();
  }

  static async onSaveConfig(
    this: LootRaritySettingsApp,
    _event: Event,
    target: HTMLElement,
  ): Promise<void> {
    const root = target.closest<HTMLElement>(".wastelander-loot-cap-settings");
    if (!root) return;

    const config = readConfigFromForm(root);
    if (!config.bands?.length) {
      ui.notifications.warn(t("WASTELANDER.Scavenging.Settings.LootRarityNoBands"));
      return;
    }

    await game.settings.set(MODULE_ID, SCAVENGING_SETTINGS.lootRarityConfig, config);
    this.#config = config;
    ui.notifications.info(t("WASTELANDER.Scavenging.Settings.LootRaritySaved"));
    await this.render();
  }

  static async onResetDefaults(this: LootRaritySettingsApp): Promise<void> {
    const defaults = getBundledLootRarityConfig();
    await game.settings.set(MODULE_ID, SCAVENGING_SETTINGS.lootRarityConfig, defaults);
    this.#config = defaults;
    ui.notifications.info(t("WASTELANDER.Scavenging.Settings.LootRarityResetDone"));
    await this.render();
  }
}
