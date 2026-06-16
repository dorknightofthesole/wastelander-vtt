import { describe, expect, it } from "vitest";
import { defaultHexcrawlState } from "./hexcrawlScenePersist.js";
import { DEFAULT_UNDISCOVERED_POI_ALPHA } from "./hexcrawlSettings.js";
import {
  applyHexEntryFogEffects,
  clearHexMapEdits,
  DEFAULT_HEX_COVER_COLOR,
  discoverPoiOnHexEntry,
  hexHasMapEdits,
  normalizeDiscoveredPoiHexKeys,
  normalizeHexAnnotations,
  normalizeHiddenTrailHexKeys,
  normalizeHexCoverColor,
  resolveTerrainForHex,
  revealHexCoverOnHexEntry,
  setHexAnnotation,
  setHexCover,
  setHexPoiIcon,
  shouldShowHexCover,
  shouldShowPoiIcon,
  poiDisplayAlpha,
  toggleHexCover,
  visibleTrailHexKeys,
} from "./hexAnnotations.js";

describe("hexAnnotations", () => {
  it("resolves per-hex terrain with scene default fallback", () => {
    const state = {
      ...defaultHexcrawlState("scene-a"),
      terrainType: "normal" as const,
      hexAnnotations: { "1,1": { terrain: "rough" } },
    };
    expect(resolveTerrainForHex(state, "1,1")).toBe("rough");
    expect(resolveTerrainForHex(state, "2,2")).toBe("normal");
  });

  it("filters hidden trail hex keys from visible trail", () => {
    const state = {
      ...defaultHexcrawlState("scene-a"),
      traveledHexKeys: ["0,0", "1,0", "2,0"],
      startingHexKey: "0,0",
      trailCleared: false,
      hiddenTrailHexKeys: ["1,0"],
    };
    expect(visibleTrailHexKeys(state)).toEqual(["0,0", "2,0"]);
  });

  it("strips unknown poi icon ids on normalize", () => {
    expect(
      normalizeHexAnnotations({
        "3,3": { terrain: "open", iconId: "not-real" },
        "5,5": { iconId: "ruins" },
        "6,6": { hexCoverColor: "#ff00aa", iconId: "camp" },
        "7,7": { hexCoverColor: "bad" },
      }),
    ).toEqual({
      "3,3": { terrain: "open" },
      "5,5": { iconId: "ruins" },
      "6,6": { hexCoverColor: "#ff00aa", iconId: "camp" },
    });
  });

  it("normalizes hidden trail keys", () => {
    expect(normalizeHiddenTrailHexKeys(["1,1", "", 2])).toEqual(["1,1"]);
  });

  it("updates hex annotation terrain", () => {
    const base = defaultHexcrawlState("scene-a");
    const next = setHexAnnotation(base, "4,4", { terrain: "hard" });
    expect(next.hexAnnotations["4,4"]).toEqual({ terrain: "hard" });
  });

  it("clears poi icon from hex annotation", () => {
    const base = {
      ...defaultHexcrawlState("scene-a"),
      hexAnnotations: { "2,2": { iconId: "ruins" as const } },
    };
    const next = setHexPoiIcon(base, "2,2", null);
    expect(next.hexAnnotations["2,2"]).toBeUndefined();
  });

  it("toggles poi icon assignment", () => {
    const base = defaultHexcrawlState("scene-a");
    const assigned = setHexPoiIcon(base, "2,2", "camp");
    expect(assigned.hexAnnotations["2,2"]).toEqual({ iconId: "camp" });
    const cleared = setHexPoiIcon(assigned, "2,2", null);
    expect(cleared.hexAnnotations["2,2"]).toBeUndefined();
  });

  it("clears poi icon but keeps terrain override", () => {
    const base = {
      ...defaultHexcrawlState("scene-a"),
      hexAnnotations: { "2,2": { terrain: "rough" as const, iconId: "camp" as const } },
    };
    const next = setHexAnnotation(base, "2,2", { iconId: undefined });
    expect(next.hexAnnotations["2,2"]).toEqual({ terrain: "rough" });
  });

  it("clears all map edits on a hex", () => {
    const base = {
      ...defaultHexcrawlState("scene-a"),
      hexAnnotations: { "3,3": { terrain: "open" as const, iconId: "ruins" as const } },
      hiddenTrailHexKeys: ["3,3"],
    };
    const next = clearHexMapEdits(base, "3,3");
    expect(next.hexAnnotations["3,3"]).toBeUndefined();
    expect(next.hiddenTrailHexKeys).toEqual([]);
  });

  it("reports whether a hex has map edits", () => {
    const base = {
      ...defaultHexcrawlState("scene-a"),
      hexAnnotations: { "1,1": { iconId: "camp" as const } },
      hiddenTrailHexKeys: ["2,2"],
    };
    expect(hexHasMapEdits(base, "1,1")).toBe(true);
    expect(hexHasMapEdits(base, "2,2")).toBe(true);
    expect(hexHasMapEdits(base, "9,9")).toBe(false);
  });

  it("discovers poi on hex entry once", () => {
    const base = {
      ...defaultHexcrawlState("scene-a"),
      hexAnnotations: { "3,3": { iconId: "ruins" as const } },
      discoveredPoiHexKeys: [],
    };
    const discovered = discoverPoiOnHexEntry(base, "3,3");
    expect(discovered.state.discoveredPoiHexKeys).toEqual(["3,3"]);
    expect(discovered.discovered).toEqual({
      hexKey: "3,3",
      iconId: "ruins",
      label: "Ruins",
    });
    expect(discovered.state.journeyLog[0]).toMatchObject({
      kind: "poiDiscovered",
      hexKey: "3,3",
      poiLabel: "Ruins",
      note: "ruins",
    });
    const again = discoverPoiOnHexEntry(discovered.state, "3,3");
    expect(again.state).toBe(discovered.state);
    expect(again.discovered).toBeNull();
    const none = discoverPoiOnHexEntry(base, "9,9");
    expect(none.state).toBe(base);
    expect(none.discovered).toBeNull();
  });

  it("hides undiscovered poi icons from players", () => {
    const state = {
      ...defaultHexcrawlState("scene-a"),
      hexAnnotations: { "1,1": { iconId: "camp" as const } },
      discoveredPoiHexKeys: [],
    };
    expect(shouldShowPoiIcon(state, "1,1", false)).toBe(false);
    expect(shouldShowPoiIcon(state, "1,1", true)).toBe(true);
    expect(
      shouldShowPoiIcon(
        { ...state, discoveredPoiHexKeys: ["1,1"] },
        "1,1",
        false,
      ),
    ).toBe(true);
  });

  it("ghosts undiscovered poi display for overseer preview only", () => {
    const state = {
      ...defaultHexcrawlState("scene-a"),
      hexAnnotations: { "1,1": { iconId: "camp" as const } },
      discoveredPoiHexKeys: [] as string[],
    };
    expect(poiDisplayAlpha(state, "1,1", false)).toBe(1);
    expect(poiDisplayAlpha(state, "1,1", true, DEFAULT_UNDISCOVERED_POI_ALPHA)).toBe(
      DEFAULT_UNDISCOVERED_POI_ALPHA,
    );
    expect(
      poiDisplayAlpha({ ...state, discoveredPoiHexKeys: ["1,1"] }, "1,1", true),
    ).toBe(1);
  });

  it("normalizes discovered poi hex keys", () => {
    expect(normalizeDiscoveredPoiHexKeys(["1,1", "1,1", "", 2])).toEqual(["1,1"]);
  });

  it("clears discovered poi when hex map data is cleared", () => {
    const base = {
      ...defaultHexcrawlState("scene-a"),
      hexAnnotations: { "3,3": { iconId: "ruins" as const } },
      discoveredPoiHexKeys: ["3,3"],
    };
    const next = clearHexMapEdits(base, "3,3");
    expect(next.discoveredPoiHexKeys).toEqual([]);
  });

  it("toggles hex cover with default gray", () => {
    const base = defaultHexcrawlState("scene-a");
    const covered = toggleHexCover(base, "2,2");
    expect(covered.hexAnnotations["2,2"]).toEqual({ hexCoverColor: DEFAULT_HEX_COVER_COLOR });
    const custom = toggleHexCover(base, "3,3", "#aabbcc");
    expect(custom.hexAnnotations["3,3"]).toEqual({ hexCoverColor: "#aabbcc" });
    const cleared = toggleHexCover(covered, "2,2");
    expect(cleared.hexAnnotations["2,2"]).toBeUndefined();
  });

  it("sets custom hex cover color", () => {
    const base = defaultHexcrawlState("scene-a");
    const next = setHexCover(base, "4,4", "#aabbcc");
    expect(next.hexAnnotations["4,4"]).toEqual({ hexCoverColor: "#aabbcc" });
    expect(normalizeHexCoverColor("#AABBCC")).toBe("#aabbcc");
  });

  it("deletes hex cover from persistence on entry", () => {
    const base = {
      ...defaultHexcrawlState("scene-a"),
      hexAnnotations: { "1,1": { hexCoverColor: "#808080" as const } },
    };
    expect(shouldShowHexCover(base, "1,1", false)).toBe(true);
    const cleared = revealHexCoverOnHexEntry(base, "1,1");
    expect(cleared.hexAnnotations["1,1"]).toBeUndefined();
    expect(shouldShowHexCover(cleared, "1,1", false)).toBe(false);
    expect(shouldShowHexCover(cleared, "1,1", true)).toBe(false);
  });

  it("applies poi discover and cover deletion on hex entry", () => {
    const base = {
      ...defaultHexcrawlState("scene-a"),
      hexAnnotations: {
        "2,2": { iconId: "camp" as const, hexCoverColor: "#808080" as const },
      },
      discoveredPoiHexKeys: [],
    };
    const fog = applyHexEntryFogEffects(base, "2,2");
    expect(fog.state.discoveredPoiHexKeys).toEqual(["2,2"]);
    expect(fog.state.hexAnnotations["2,2"]).toEqual({ iconId: "camp" });
    expect(fog.discovered?.label).toBe("Camp");
    expect(fog.state.journeyLog[0]?.kind).toBe("poiDiscovered");
    expect(shouldShowPoiIcon(fog.state, "2,2", false)).toBe(true);
    expect(shouldShowHexCover(fog.state, "2,2", false)).toBe(false);
  });

  it("clears hex cover when hex map data is cleared", () => {
    const base = {
      ...defaultHexcrawlState("scene-a"),
      hexAnnotations: { "3,3": { hexCoverColor: "#808080" as const } },
    };
    const next = clearHexMapEdits(base, "3,3");
    expect(next.hexAnnotations["3,3"]).toBeUndefined();
  });
});
