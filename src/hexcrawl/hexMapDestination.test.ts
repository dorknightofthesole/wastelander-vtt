import { describe, expect, it, vi, afterEach } from "vitest";
import * as hexcrawlScenePersist from "./hexcrawlScenePersist.js";
import { defaultHexcrawlState } from "./hexcrawlScenePersist.js";
import {
  applyDestinationArrivalProgress,
  backfillMapDestinationReached,
  clearMapDestination,
  discoverMapDestinationOnHexEntry,
  ensureInheritedProgressDestinationCached,
  formatProgressDestinationLabel,
  progressDestinationDisplayLabel,
  normalizeMapDestination,
  resolveProgressDestination,
  setMapDestination,
  shouldShowMapDestination,
} from "./hexMapDestination.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hexMapDestination", () => {
  it("normalizes map destination", () => {
    expect(normalizeMapDestination({ hexKey: " 2,2 ", name: " Vault 13 " })).toEqual({
      hexKey: "2,2",
      name: "Vault 13",
    });
    expect(normalizeMapDestination({ hexKey: "", name: "X" })).toBeNull();
  });

  it("sets one destination per scene and resets reached when hex moves", () => {
    const base = {
      ...defaultHexcrawlState("scene-a"),
      mapDestinationReached: true,
      mapDestination: { hexKey: "1,1", name: "Old" },
    };
    const next = setMapDestination(base, "3,3", "New City");
    expect(next.mapDestination).toEqual({ hexKey: "3,3", name: "New City" });
    expect(next.mapDestinationReached).toBe(false);
  });

  it("clears destination state", () => {
    const base = {
      ...defaultHexcrawlState("scene-a"),
      mapDestination: { hexKey: "1,1", name: "City" },
      mapDestinationReached: true,
    };
    const next = clearMapDestination(base);
    expect(next.mapDestination).toBeNull();
    expect(next.mapDestinationReached).toBe(false);
  });

  it("hides destination marker from players until arrival", () => {
    const state = {
      ...defaultHexcrawlState("scene-a"),
      mapDestination: { hexKey: "2,2", name: "City" },
      mapDestinationReached: false,
    };
    expect(shouldShowMapDestination(state, true)).toBe(true);
    expect(shouldShowMapDestination(state, false)).toBe(false);
    expect(shouldShowMapDestination({ ...state, mapDestinationReached: true }, false)).toBe(true);
  });

  it("reveals destination on hex entry once", () => {
    const base = {
      ...defaultHexcrawlState("scene-a"),
      startingHexKey: "0,0",
      mapDestination: { hexKey: "4,4", name: "Settlement" },
      mapDestinationReached: false,
      traveledHexKeys: ["1,1", "4,4"],
      hoursTraveledToday: 5.5,
      milesTraveledCumulative: 36,
    };
    const arrived = discoverMapDestinationOnHexEntry(base, "4,4");
    expect(arrived.arrival).toEqual({ hexKey: "4,4", name: "Settlement" });
    expect(arrived.state.mapDestination).toBeNull();
    expect(arrived.state.inheritedProgressDestination).toBeNull();
    expect(arrived.state.startingHexKey).toBe("4,4");
    expect(arrived.state.lastHexKey).toBe("4,4");
    expect(arrived.state.hoursTraveledToday).toBe(0);
    expect(arrived.state.milesTraveledCumulative).toBe(0);
    expect(arrived.state.traveledHexKeys).toEqual(["1,1", "4,4"]);
    expect(arrived.state.journeyLog[0]?.kind).toBe("destinationReached");
    const again = discoverMapDestinationOnHexEntry(arrived.state, "4,4");
    expect(again.arrival).toBeNull();
  });

  it("still fires arrival when legacy backfill marked reached but the marker remains", () => {
    const base = {
      ...defaultHexcrawlState("scene-a"),
      startingHexKey: "0,0",
      mapDestination: { hexKey: "4,4", name: "Settlement" },
      mapDestinationReached: true,
      traveledHexKeys: ["0,0", "4,4"],
    };
    const arrived = discoverMapDestinationOnHexEntry(base, "4,4");
    expect(arrived.arrival).toEqual({ hexKey: "4,4", name: "Settlement" });
    expect(arrived.state.mapDestination).toBeNull();
  });

  it("clears inherited progress cache on arrival", () => {
    const base = {
      ...defaultHexcrawlState("scene-a"),
      startingHexKey: "0,0",
      mapDestination: { hexKey: "4,4", name: "Settlement" },
      inheritedProgressDestination: {
        name: "Megaton",
        hexKey: "0,0",
        sourceSceneId: "scene-south",
        sourceSceneName: "Southern Wastes",
      },
    };
    const arrived = discoverMapDestinationOnHexEntry(base, "4,4");
    expect(arrived.arrival).not.toBeNull();
    expect(arrived.state.inheritedProgressDestination).toBeNull();
  });

  it("resets hours and miles and promotes the arrival hex to starting hex", () => {
    const state = {
      ...defaultHexcrawlState("scene-a"),
      startingHexKey: "0,0",
      lastHexKey: "4,4",
      traveledHexKeys: ["0,0", "2,2", "4,4"],
      hoursTraveledToday: 6,
      milesTraveledCumulative: 18,
      travelDay: 3,
    };
    const next = applyDestinationArrivalProgress(state, "4,4");
    expect(next.hoursTraveledToday).toBe(0);
    expect(next.milesTraveledCumulative).toBe(0);
    expect(next.startingHexKey).toBe("4,4");
    expect(next.lastHexKey).toBe("4,4");
    expect(next.traveledHexKeys).toEqual(["0,0", "2,2", "4,4"]);
    expect(next.travelDay).toBe(3);
  });

  it("uses local destination for progress before linked scenes", () => {
    const game = globalThis.game as {
      scenes?: { get: (id: string) => { name?: string } | undefined };
    };
    game.scenes = {
      get: (id: string) => (id === "scene-a" ? { name: "Current Map" } : undefined),
    };

    const state = {
      ...defaultHexcrawlState("scene-a"),
      mapDestination: { hexKey: "5,5", name: "Local Goal" },
    };
    expect(resolveProgressDestination("scene-a", state)).toEqual({
      name: "Local Goal",
      hexKey: "5,5",
      sourceSceneId: "scene-a",
      sourceSceneName: "Current Map",
      inherited: false,
    });
    expect(formatProgressDestinationLabel(resolveProgressDestination("scene-a", state)!)).toBe(
      "Local Goal",
    );
  });

  it("clears stale inherited cache when the scene has a local map destination", () => {
    const staleInherited = {
      name: "Megaton",
      hexKey: "0,0",
      sourceSceneId: "scene-south",
      sourceSceneName: "Southern Wastes",
    };
    const state = {
      ...defaultHexcrawlState("scene-a"),
      mapDestination: { hexKey: "5,5", name: "Local Goal" },
      inheritedProgressDestination: staleInherited,
    };
    const ensured = ensureInheritedProgressDestinationCached(state);
    expect(ensured.changed).toBe(true);
    expect(ensured.state.inheritedProgressDestination).toBeNull();
  });

  it("caches inherited destination locally after linked search", () => {
    const game = globalThis.game as {
      scenes?: { get: (id: string) => { name?: string } | undefined };
    };
    game.scenes = {
      get: (id: string) => {
        if (id === "scene-south") return { name: "Southern Wastes" };
        return undefined;
      },
    };

    vi.spyOn(hexcrawlScenePersist, "loadHexcrawlSceneState").mockImplementation((sceneId: string) => {
      if (sceneId === "scene-south") {
        return {
          ...defaultHexcrawlState("scene-south"),
          mapDestination: { hexKey: "0,0", name: "Megaton" },
        };
      }
      return null;
    });

    const state = {
      ...defaultHexcrawlState("scene-a"),
      sceneLinks: { south: "scene-south" },
    };
    const ensured = ensureInheritedProgressDestinationCached(state);
    expect(ensured.changed).toBe(true);
    expect(ensured.state.inheritedProgressDestination).toEqual({
      name: "Megaton",
      hexKey: "0,0",
      sourceSceneId: "scene-south",
      sourceSceneName: "Southern Wastes",
    });

    const ensuredAgain = ensureInheritedProgressDestinationCached(ensured.state);
    expect(ensuredAgain.changed).toBe(false);

    const loadSpy = vi.mocked(hexcrawlScenePersist.loadHexcrawlSceneState);
    loadSpy.mockClear();
    const resolved = resolveProgressDestination("scene-a", ensured.state);
    expect(resolved?.name).toBe("Megaton");
    expect(formatProgressDestinationLabel(resolved!)).toBe("Megaton (Southern Wastes)");
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).toHaveBeenCalledWith("scene-south");
  });

  it("inherits destination from the first linked scene that has one", () => {
    const game = globalThis.game as {
      scenes?: { get: (id: string) => { name?: string } | undefined };
    };
    game.scenes = {
      get: (id: string) => {
        if (id === "scene-a") return { name: "Current Map" };
        if (id === "scene-south") return { name: "Southern Wastes" };
        return undefined;
      },
    };

    vi.spyOn(hexcrawlScenePersist, "loadHexcrawlSceneState").mockImplementation((sceneId: string) => {
      if (sceneId === "scene-south") {
        return {
          ...defaultHexcrawlState("scene-south"),
          mapDestination: { hexKey: "0,0", name: "Megaton" },
        };
      }
      return null;
    });

    const state = {
      ...defaultHexcrawlState("scene-a"),
      sceneLinks: { south: "scene-south" },
    };
    expect(resolveProgressDestination("scene-a", state)).toEqual({
      name: "Megaton",
      hexKey: "0,0",
      sourceSceneId: "scene-south",
      sourceSceneName: "Southern Wastes",
      inherited: true,
    });
    expect(formatProgressDestinationLabel(resolveProgressDestination("scene-a", state)!)).toBe(
      "Megaton (Southern Wastes)",
    );
  });

  it("uses a not-set label when no destination resolves", () => {
    const state = defaultHexcrawlState("scene-a");
    expect(progressDestinationDisplayLabel("scene-a", state, "Not set")).toBe("Not set");
  });

  it("backfills reached flag from traveled hex keys", () => {
    const state = {
      ...defaultHexcrawlState("scene-a"),
      mapDestination: { hexKey: "2,2", name: "City" },
      mapDestinationReached: false,
      traveledHexKeys: ["1,1", "2,2"],
    };
    expect(backfillMapDestinationReached(state).mapDestinationReached).toBe(true);
  });
});
