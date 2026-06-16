import { MODULE_ID, MODULE_PATH } from "../constants.js";
import { t } from "../integrations/i18n.js";
import {
  gearMapFromRows,
  gearRowsFromMap,
  getDefaultNpcGearMappingsConfig,
  getNpcGearMappingsConfig,
  normalizeNpcGearMappingsConfig,
  type NpcGearMappingFormRow,
  type NpcGearMappingsConfig,
} from "./npcGearMappings.js";
import { NPC_GENERATOR_SETTINGS } from "./npcGeneratorSettings.js";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;


type GearSection = "professions" | "demeanor";

function readRowsFromForm(
  root: HTMLElement,
  section: GearSection,
): NpcGearMappingFormRow[] {
  const rows: NpcGearMappingFormRow[] = [];
  const tableRows = root.querySelectorAll<HTMLTableRowElement>(
    `tbody[data-gear-section="${section}"] tr[data-gear-index]`,
  );
  for (const row of tableRows) {
    const key =
      row.querySelector<HTMLInputElement>('[data-field="key"]')?.value?.trim() ?? "";
    const itemsText =
      row.querySelector<HTMLInputElement>('[data-field="items"]')?.value ?? "";
    const rollsText =
      row.querySelector<HTMLInputElement>('[data-field="rolls"]')?.value ?? "";
    if (!key) continue;
    rows.push({ key, itemsText, rollsText });
  }
  return rows;
}

function readConfigFromForm(root: HTMLElement): NpcGearMappingsConfig {
  return normalizeNpcGearMappingsConfig({
    professions: gearMapFromRows(readRowsFromForm(root, "professions")),
    demeanor: gearMapFromRows(readRowsFromForm(root, "demeanor")),
  });
}

export default class NpcGearMappingsSettingsApp extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  #config: NpcGearMappingsConfig = getDefaultNpcGearMappingsConfig();
  #loadedFromSettings = false;

  static override DEFAULT_OPTIONS = {
    id: "wastelander-npc-gear-mappings-settings",
    tag: "form",
    classes: ["wastelander-wizard", "wastelander-loot-cap-settings-app"],
    window: {
      title: "WASTELANDER.NpcGen.Settings.GearMappingsMenuTitle",
      icon: "fa-solid fa-suitcase",
    },
    position: { width: 720, height: "auto" },
    actions: {
      addProfessionRow: NpcGearMappingsSettingsApp.onAddProfessionRow,
      addDemeanorRow: NpcGearMappingsSettingsApp.onAddDemeanorRow,
      removeProfessionRow: NpcGearMappingsSettingsApp.onRemoveProfessionRow,
      removeDemeanorRow: NpcGearMappingsSettingsApp.onRemoveDemeanorRow,
      saveConfig: NpcGearMappingsSettingsApp.onSaveConfig,
      resetDefaults: NpcGearMappingsSettingsApp.onResetDefaults,
    },
  };

  static override PARTS = {
    body: {
      template: `${MODULE_PATH}/templates/npcGen/gear-mappings-settings.hbs`,
    },
  };

  protected override async _prepareContext(): Promise<Record<string, unknown>> {
    if (!this.#loadedFromSettings) {
      this.#config = getNpcGearMappingsConfig();
      this.#loadedFromSettings = true;
    }

    return {
      professionRows: gearRowsFromMap(this.#config.professions ?? {}),
      demeanorRows: gearRowsFromMap(this.#config.demeanor ?? {}),
    };
  }

  static onAddProfessionRow(
    this: NpcGearMappingsSettingsApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    NpcGearMappingsSettingsApp.#addRow(this, "professions", target);
  }

  static onAddDemeanorRow(
    this: NpcGearMappingsSettingsApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    NpcGearMappingsSettingsApp.#addRow(this, "demeanor", target);
  }

  static onRemoveProfessionRow(
    this: NpcGearMappingsSettingsApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    NpcGearMappingsSettingsApp.#removeRow(this, "professions", target);
  }

  static onRemoveDemeanorRow(
    this: NpcGearMappingsSettingsApp,
    _event: Event,
    target: HTMLElement,
  ): void {
    NpcGearMappingsSettingsApp.#removeRow(this, "demeanor", target);
  }

  static #addRow(
    app: NpcGearMappingsSettingsApp,
    section: GearSection,
    target: HTMLElement,
  ): void {
    const root = target.closest<HTMLElement>(".wastelander-npc-gear-mappings-settings");
    if (!root) return;

    const config = readConfigFromForm(root);
    const map = { ...(config[section] ?? {}) };
    let index = 1;
    const base = section === "professions" ? "New profession" : "New demeanor";
    let key = `${base} ${index}`;
    while (map[key]) {
      index += 1;
      key = `${base} ${index}`;
    }
    map[key] = { items: [] };

    app.#config = { ...config, [section]: map };
    void app.render();
  }

  static #removeRow(
    app: NpcGearMappingsSettingsApp,
    section: GearSection,
    target: HTMLElement,
  ): void {
    const root = target.closest<HTMLElement>(".wastelander-npc-gear-mappings-settings");
    if (!root) return;

    const index = Number(target.closest<HTMLElement>("[data-gear-index]")?.dataset.gearIndex);
    if (!Number.isFinite(index)) return;

    const rows = readRowsFromForm(root, section);
    rows.splice(index, 1);

    app.#config = {
      ...readConfigFromForm(root),
      [section]: gearMapFromRows(rows),
    };
    void app.render();
  }

  static async onSaveConfig(
    this: NpcGearMappingsSettingsApp,
    _event: Event,
    target: HTMLElement,
  ): Promise<void> {
    const root = target.closest<HTMLElement>(".wastelander-npc-gear-mappings-settings");
    if (!root) return;

    const config = readConfigFromForm(root);
    const professionCount = Object.keys(config.professions ?? {}).length;
    const demeanorCount = Object.keys(config.demeanor ?? {}).length;
    if (!professionCount && !demeanorCount) {
      ui.notifications.warn(t("WASTELANDER.NpcGen.Settings.GearMappingsNoRows"));
      return;
    }

    await game.settings.set(MODULE_ID, NPC_GENERATOR_SETTINGS.npcGearMappings, config);
    this.#config = config;
    ui.notifications.info(t("WASTELANDER.NpcGen.Settings.GearMappingsSaved"));
    await this.render();
  }

  static async onResetDefaults(this: NpcGearMappingsSettingsApp): Promise<void> {
    const defaults = getDefaultNpcGearMappingsConfig();
    await game.settings.set(MODULE_ID, NPC_GENERATOR_SETTINGS.npcGearMappings, defaults);
    this.#config = defaults;
    ui.notifications.info(t("WASTELANDER.NpcGen.Settings.GearMappingsResetDone"));
    await this.render();
  }
}
