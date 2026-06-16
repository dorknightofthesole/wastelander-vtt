import { describe, expect, it, afterEach } from "vitest";
import { DEFAULT_HEX_COVER_COLOR } from "./hexAnnotations.js";
import {
  captureHexCoverBrushFromPicker,
  getEffectiveLastHexCoverColor,
  getLastHexCoverColor,
  HEXCRAWL_SETTINGS,
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
});
