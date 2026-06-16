import { describe, expect, it, afterEach } from "vitest";
import { DEFAULT_HEX_COVER_COLOR } from "./hexAnnotations.js";
import {
  captureHexCoverBrushFromPicker,
  getEffectiveLastHexCoverColor,
  getLastHexCoverColor,
  DEFAULT_UNDISCOVERED_POI_ALPHA,
  getUndiscoveredPoiAlpha,
  HEXCRAWL_SETTINGS,
  normalizeUndiscoveredPoiAlpha,
  rememberLastHexCoverColor,
  resetHexCoverBrushCacheForTests,
  resolveHexCoverPickerColor,
  setLastHexCoverColor,
} from "./hexcrawlSettings.js";

describe("hexcrawlSettings lastHexCoverColor", () => {
  const prevGame = (globalThis as { game?: unknown }).game;
  const stored: Record<string, unknown> = {};

  afterEach(() => {
    (globalThis as { game?: unknown }).game = prevGame;
    for (const key of Object.keys(stored)) delete stored[key];
    resetHexCoverBrushCacheForTests();
  });

  it("returns default gray when unset", () => {
    (globalThis as { game?: unknown }).game = {
      settings: {
        get: () => undefined,
        set: async () => undefined,
      },
    };
    expect(getLastHexCoverColor()).toBe(DEFAULT_HEX_COVER_COLOR);
    expect(getEffectiveLastHexCoverColor()).toBe(DEFAULT_HEX_COVER_COLOR);
  });

  it("persists and reads the last cover color", async () => {
    (globalThis as { game?: unknown }).game = {
      settings: {
        get: (_scope: string, key: string) => stored[key],
        set: async (_scope: string, key: string, value: string) => {
          stored[key] = value;
        },
      },
    };

    await setLastHexCoverColor("#a1b2c3");
    expect(stored[HEXCRAWL_SETTINGS.lastHexCoverColor]).toBe("#a1b2c3");
    expect(getEffectiveLastHexCoverColor()).toBe("#a1b2c3");
  });

  it("keeps brush color in memory across reads", () => {
    (globalThis as { game?: unknown }).game = {
      settings: {
        get: () => DEFAULT_HEX_COVER_COLOR,
        set: async () => undefined,
      },
    };
    rememberLastHexCoverColor("#ff5500");
    expect(getEffectiveLastHexCoverColor()).toBe("#ff5500");
  });

  it("captures brush color from picker input", () => {
    (globalThis as { game?: unknown }).game = {
      settings: { get: () => DEFAULT_HEX_COVER_COLOR, set: async () => undefined },
    };
    const root = {
      querySelector: (selector: string) =>
        selector === "#hexcrawl-map-hex-cover-color" ? { value: "#aabbcc" } : null,
    } as unknown as HTMLElement;

    expect(captureHexCoverBrushFromPicker(root)).toBe(true);
    expect(getEffectiveLastHexCoverColor()).toBe("#aabbcc");
  });

  it("resolves picker color from hex cover or brush default", () => {
    (globalThis as { game?: unknown }).game = {
      settings: { get: () => DEFAULT_HEX_COVER_COLOR, set: async () => undefined },
    };
    expect(resolveHexCoverPickerColor()).toBe(DEFAULT_HEX_COVER_COLOR);
    expect(resolveHexCoverPickerColor("#ff00aa")).toBe("#ff00aa");
  });

  it("ignores invalid colors on save", async () => {
    let setCalled = false;
    (globalThis as { game?: unknown }).game = {
      settings: {
        get: () => DEFAULT_HEX_COVER_COLOR,
        set: async () => {
          setCalled = true;
        },
      },
    };
    await setLastHexCoverColor("not-a-color");
    expect(setCalled).toBe(false);
  });

  it("normalizes undiscovered poi alpha to 0–1", () => {
    expect(normalizeUndiscoveredPoiAlpha(undefined)).toBe(DEFAULT_UNDISCOVERED_POI_ALPHA);
    expect(normalizeUndiscoveredPoiAlpha(0.5)).toBe(0.5);
    expect(normalizeUndiscoveredPoiAlpha(-1)).toBe(0);
    expect(normalizeUndiscoveredPoiAlpha(2)).toBe(1);
  });

  it("reads undiscovered poi alpha from module settings", () => {
    (globalThis as { game?: unknown }).game = {
      settings: {
        get: (_scope: string, key: string) =>
          key === HEXCRAWL_SETTINGS.undiscoveredPoiAlpha ? 0.2 : undefined,
        set: async () => undefined,
      },
    };
    expect(getUndiscoveredPoiAlpha()).toBe(0.2);
  });
});
