import { MODULE_ID } from "../constants.js";

export const HEXCRAWL_SETTINGS = {
  advanceWorldClockOnTravel: "advanceWorldClockOnTravel",
  wastelandTravelsJournalId: "wastelandTravelsJournalId",
} as const;

export function registerHexcrawlSettings(): void {
  const settings = (game as {
    settings?: {
      register: (...args: unknown[]) => void;
      get: (scope: string, key: string) => unknown;
    };
  }).settings;
  if (!settings?.register) return;

  settings.register(MODULE_ID, HEXCRAWL_SETTINGS.advanceWorldClockOnTravel, {
    name: "WASTELANDER.Hexcrawl.Settings.AdvanceWorldClockName",
    hint: "WASTELANDER.Hexcrawl.Settings.AdvanceWorldClockHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  settings.register(MODULE_ID, HEXCRAWL_SETTINGS.wastelandTravelsJournalId, {
    scope: "world",
    config: false,
    type: String,
    default: "",
  });
}

export function getHexcrawlSettingBoolean(key: string): boolean {
  const settings = (game as { settings?: { get: (scope: string, k: string) => unknown } })
    .settings;
  return Boolean(settings?.get(MODULE_ID, key));
}
