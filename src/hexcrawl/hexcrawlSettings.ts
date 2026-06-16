import { MODULE_ID } from "../constants.js";
import { DEFAULT_HEX_COVER_COLOR, normalizeHexCoverColor } from "./hexAnnotations.js";

export const HEXCRAWL_SETTINGS = {
  advanceWorldClockOnTravel: "advanceWorldClockOnTravel",
  wastelandTravelsJournalId: "wastelandTravelsJournalId",
  lastHexCoverColor: "lastHexCoverColor",
  debugHexCover: "debugHexCover",
  debugStartingLocation: "debugStartingLocation",
} as const;

/** In-memory brush color for the map editor (survives hex selection and re-renders). */
let cachedHexCoverBrushColor: string | null = null;

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

  settings.register(MODULE_ID, HEXCRAWL_SETTINGS.lastHexCoverColor, {
    scope: "world",
    config: false,
    type: String,
    default: DEFAULT_HEX_COVER_COLOR,
  });

  settings.register(MODULE_ID, HEXCRAWL_SETTINGS.debugHexCover, {
    name: "WASTELANDER.Hexcrawl.Settings.DebugHexCoverName",
    hint: "WASTELANDER.Hexcrawl.Settings.DebugHexCoverHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  settings.register(MODULE_ID, HEXCRAWL_SETTINGS.debugStartingLocation, {
    name: "WASTELANDER.Hexcrawl.Settings.DebugStartingLocationName",
    hint: "WASTELANDER.Hexcrawl.Settings.DebugStartingLocationHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });
}

export function getLastHexCoverColor(): string {
  const settings = (game as { settings?: { get: (scope: string, k: string) => unknown } })
    .settings;
  const stored = normalizeHexCoverColor(
    settings?.get(MODULE_ID, HEXCRAWL_SETTINGS.lastHexCoverColor),
  );
  return stored ?? DEFAULT_HEX_COVER_COLOR;
}

async function persistLastHexCoverColor(normalized: string): Promise<void> {
  const settings = (game as {
    settings?: { set: (scope: string, key: string, value: string) => Promise<unknown> };
  }).settings;
  if (!settings?.set) return;
  await settings.set(MODULE_ID, HEXCRAWL_SETTINGS.lastHexCoverColor, normalized);
}

export async function setLastHexCoverColor(color: string): Promise<void> {
  const normalized = normalizeHexCoverColor(color);
  if (!normalized) return;
  cachedHexCoverBrushColor = normalized;
  await persistLastHexCoverColor(normalized);
}

/** Color used when placing a new hex cover or shown in the picker. */
export function getEffectiveLastHexCoverColor(): string {
  const candidate = cachedHexCoverBrushColor ?? getLastHexCoverColor();
  return normalizeHexCoverColor(candidate) ?? DEFAULT_HEX_COVER_COLOR;
}

export function rememberLastHexCoverColor(color: string): void {
  const normalized = normalizeHexCoverColor(color);
  if (!normalized) return;
  cachedHexCoverBrushColor = normalized;
  void persistLastHexCoverColor(normalized);
}

export function captureHexCoverBrushFromPicker(root: HTMLElement | null | undefined): boolean {
  const input = root?.querySelector<HTMLInputElement>("#hexcrawl-map-hex-cover-color");
  if (!input?.value) return false;
  const normalized = normalizeHexCoverColor(input.value);
  if (!normalized) return false;
  rememberLastHexCoverColor(normalized);
  return true;
}

/** Value for the map color input: hex cover when editing one, else placement brush. */
export function resolveHexCoverPickerColor(hexCoverColor?: string): string {
  return normalizeHexCoverColor(hexCoverColor) ?? getEffectiveLastHexCoverColor();
}

export function primeHexCoverBrushCache(): void {
  if (normalizeHexCoverColor(cachedHexCoverBrushColor)) return;
  cachedHexCoverBrushColor = getLastHexCoverColor();
}

/** @internal */
export function resetHexCoverBrushCacheForTests(): void {
  cachedHexCoverBrushColor = null;
}

export function getHexcrawlSettingBoolean(key: string): boolean {
  const settings = (game as { settings?: { get: (scope: string, k: string) => unknown } })
    .settings;
  return Boolean(settings?.get(MODULE_ID, key));
}

export function isHexCoverDebugEnabled(): boolean {
  const settings = (game as { settings?: { get: (scope: string, k: string) => unknown } })
    .settings;
  if (!settings?.get) return false;
  const raw = settings.get(MODULE_ID, HEXCRAWL_SETTINGS.debugHexCover);
  return Boolean(raw);
}

export function isStartingLocationDebugEnabled(): boolean {
  const settings = (game as { settings?: { get: (scope: string, k: string) => unknown } })
    .settings;
  if (!settings?.get) return false;
  const raw = settings.get(MODULE_ID, HEXCRAWL_SETTINGS.debugStartingLocation);
  return Boolean(raw);
}
