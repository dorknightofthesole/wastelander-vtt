import { MODULE_ID } from "../constants.js";

export const SCAVENGING_SETTINGS = {
  preferFoundryTables: "preferFoundryTables",
  searchRollWhisper: "searchRollWhisper",
  autoAllocateDegreeReduction: "autoAllocateDegreeReduction",
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

  settings.register(MODULE_ID, SCAVENGING_SETTINGS.autoAllocateDegreeReduction, {
    name: "WASTELANDER.Scavenging.Settings.AutoDegreeReduction",
    hint: "WASTELANDER.Scavenging.Settings.AutoDegreeReductionHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
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
