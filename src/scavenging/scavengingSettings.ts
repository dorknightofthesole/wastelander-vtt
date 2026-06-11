import { MODULE_ID } from "../constants.js";
import DenizenImportMenuApp from "./DenizenImportMenuApp.js";
import LootValueCapSettingsApp from "./LootValueCapSettingsApp.js";

export const SCAVENGING_SETTINGS = {
  preferFoundryTables: "preferFoundryTables",
  searchRollWhisper: "searchRollWhisper",
  advanceWorldClockOnSearch: "advanceWorldClockOnSearch",
  autoAllocateDegreeReduction: "autoAllocateDegreeReduction",
  /** World id of the shared Overseer Scavenger journal. */
  scavengerJournalId: "scavengerJournalId",
  /** When true, filter scavenging loot rows by location level → max caps table. */
  lootValueFilterEnabled: "lootValueFilterEnabled",
  /** GM override for level → max caps bands (empty uses bundled defaults). */
  lootValueCapConfig: "lootValueCapConfig",
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
    name: "WASTELANDER.Scavenging.Settings.LootValueFilterEnabled",
    hint: "WASTELANDER.Scavenging.Settings.LootValueFilterEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  settings.register(MODULE_ID, SCAVENGING_SETTINGS.lootValueCapConfig, {
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

  settings.registerMenu(MODULE_ID, "importDenizens", {
    name: "WASTELANDER.Denizens.Import.MenuName",
    label: "WASTELANDER.Denizens.Import.MenuLabel",
    hint: "WASTELANDER.Denizens.Import.MenuHint",
    icon: "fas fa-file-import",
    type: DenizenImportMenuApp,
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
