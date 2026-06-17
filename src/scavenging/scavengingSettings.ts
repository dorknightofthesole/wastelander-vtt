import { MODULE_ID } from "../constants.js";
import LootRaritySettingsApp from "./LootRaritySettingsApp.js";
import LootValueCapSettingsApp from "./LootValueCapSettingsApp.js";

export const SCAVENGING_SETTINGS = {
  preferFoundryTables: "preferFoundryTables",
  searchRollWhisper: "searchRollWhisper",
  advanceWorldClockOnSearch: "advanceWorldClockOnSearch",
  autoAllocateDegreeReduction: "autoAllocateDegreeReduction",
  /** World id of the shared Overseer Scavenger journal. */
  scavengerJournalId: "scavengerJournalId",
  /** @deprecated Migrated to lootFilterMode; kept for one-time upgrade. */
  lootValueFilterEnabled: "lootValueFilterEnabled",
  /** none | value | rarity — how scene loot tables are filtered when built/reset. */
  lootFilterMode: "lootFilterMode",
  /** GM override for level → max caps bands. */
  lootValueCapConfig: "lootValueCapConfig",
  /** GM override for level → max rarity bands. */
  lootRarityConfig: "lootRarityConfig",
} as const;

export function registerScavengingSettings(): void {
  const settings = (game as { settings?: { register: (...args: unknown[]) => void } })
    .settings;
  if (!settings?.register) return;

  settings.register(MODULE_ID, SCAVENGING_SETTINGS.preferFoundryTables, {
    name: "WASTELANDER.Scavenging.Settings.PreferFoundryTables",
    hint: "WASTELANDER.Scavenging.Settings.PreferFoundryTablesHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  settings.register(MODULE_ID, SCAVENGING_SETTINGS.searchRollWhisper, {
    name: "WASTELANDER.Scavenging.Settings.SearchRollWhisper",
    hint: "WASTELANDER.Scavenging.Settings.SearchRollWhisperHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  settings.register(MODULE_ID, SCAVENGING_SETTINGS.advanceWorldClockOnSearch, {
    name: "WASTELANDER.Scavenging.Settings.AdvanceWorldClockOnSearch",
    hint: "WASTELANDER.Scavenging.Settings.AdvanceWorldClockOnSearchHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  settings.register(MODULE_ID, SCAVENGING_SETTINGS.autoAllocateDegreeReduction, {
    name: "WASTELANDER.Scavenging.Settings.AutoDegreeReduction",
    hint: "WASTELANDER.Scavenging.Settings.AutoDegreeReductionHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  settings.register(MODULE_ID, SCAVENGING_SETTINGS.scavengerJournalId, {
    scope: "world",
    type: String,
    default: "",
    config: false,
  });

  settings.register(MODULE_ID, SCAVENGING_SETTINGS.lootValueFilterEnabled, {
    scope: "world",
    type: Boolean,
    default: false,
    config: false,
  });

  settings.register(MODULE_ID, SCAVENGING_SETTINGS.lootFilterMode, {
    name: "WASTELANDER.Scavenging.Settings.LootFilterMode",
    hint: "WASTELANDER.Scavenging.Settings.LootFilterModeHint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      none: "WASTELANDER.Scavenging.Settings.LootFilterModeNone",
      value: "WASTELANDER.Scavenging.Settings.LootFilterModeValue",
      rarity: "WASTELANDER.Scavenging.Settings.LootFilterModeRarity",
    },
    default: "none",
    onChange: () => {
      void game.settings.set(MODULE_ID, SCAVENGING_SETTINGS.lootValueFilterEnabled, false);
    },
  });

  settings.register(MODULE_ID, SCAVENGING_SETTINGS.lootValueCapConfig, {
    scope: "world",
    type: Object,
    default: {},
    config: false,
  });

  settings.register(MODULE_ID, SCAVENGING_SETTINGS.lootRarityConfig, {
    scope: "world",
    type: Object,
    default: {},
    config: false,
  });

  settings.registerMenu(MODULE_ID, "lootValueCapTable", {
    name: "WASTELANDER.Scavenging.Settings.LootValueCapMenuName",
    label: "WASTELANDER.Scavenging.Settings.LootValueCapMenuLabel",
    hint: "WASTELANDER.Scavenging.Settings.LootValueCapMenuHint",
    icon: "fas fa-coins",
    type: LootValueCapSettingsApp,
    restricted: true,
  });

  settings.registerMenu(MODULE_ID, "lootRarityTable", {
    name: "WASTELANDER.Scavenging.Settings.LootRarityMenuName",
    label: "WASTELANDER.Scavenging.Settings.LootRarityMenuLabel",
    hint: "WASTELANDER.Scavenging.Settings.LootRarityMenuHint",
    icon: "fas fa-gem",
    type: LootRaritySettingsApp,
    restricted: true,
  });
}

export function getScavengingSettingBoolean(key: string): boolean {
  return Boolean(
    (game.settings as { get: (scope: string, k: string) => unknown }).get(
      MODULE_ID,
      key,
    ),
  );
}
