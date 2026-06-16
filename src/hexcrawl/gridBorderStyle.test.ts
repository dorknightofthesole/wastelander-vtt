import { describe, expect, it, afterEach } from "vitest";
import { parseColorSource, resolveGridBorderStyle } from "./gridBorderStyle.js";

describe("gridBorderStyle", () => {
  const prevCanvas = (globalThis as { canvas?: unknown }).canvas;
  const prevGame = (globalThis as { game?: unknown }).game;

  afterEach(() => {
    (globalThis as { canvas?: unknown }).canvas = prevCanvas;
    (globalThis as { game?: unknown }).game = prevGame;
  });

  it("parses hex strings, numbers, and Foundry Color-like objects", () => {
    expect(parseColorSource("#aabbcc")).toBe(0xaabbcc);
    expect(parseColorSource("112233")).toBe(0x112233);
    expect(parseColorSource(0xff00aa)).toBe(0xff00aa);
    expect(parseColorSource(Object.assign(new Number(0x445566), { css: "#445566" }))).toBe(
      0x445566,
    );
    expect(parseColorSource({ css: "#778899" })).toBe(0x778899);
    expect(parseColorSource("not-a-color")).toBeNull();
  });

  it("reads grid color and alpha from canvas.grid", () => {
    (globalThis as { canvas?: unknown }).canvas = {
      grid: { color: "#336699", alpha: 0.45, thickness: 2 },
    };
    expect(resolveGridBorderStyle()).toEqual({
      color: 0x336699,
      alpha: 0.45,
      width: 2,
    });
  });

  it("merges alpha from scene document when canvas grid has no color", () => {
    (globalThis as { canvas?: unknown }).canvas = {
      scene: { id: "scene-a", grid: { color: 0x123456, alpha: 0.25 } },
      grid: { alpha: 0.9, thickness: 3 },
    };
    (globalThis as { game?: unknown }).game = {
      scenes: {
        get: (id: string) =>
          id === "scene-a" ? { grid: { color: "#123456", alpha: 0.25, thickness: 1 } } : undefined,
      },
    };
    expect(resolveGridBorderStyle()).toEqual({
      color: 0x123456,
      alpha: 0.25,
      width: 1,
    });
  });

  it("falls back to black when no grid sources exist", () => {
    (globalThis as { canvas?: unknown }).canvas = undefined;
    expect(resolveGridBorderStyle()).toEqual({
      color: 0x000000,
      alpha: 1,
      width: 1,
    });
  });
});
