import { describe, expect, it } from "vitest";
import {
  buildCrossedSceneState,
  detectBorderCrossIntent,
  detectBorderDirection,
  enumerateBorderHexKeys,
  mapEntryHexKey,
  mergeTargetSceneTrail,
  pointInBounds,
  readSceneBackgroundBounds,
  resolveExitHexKey,
  resolveSceneEntryPlacement,
} from "./sceneBorderTravel.js";
import { defaultHexcrawlState } from "./hexcrawlScenePersist.js";

const bounds = { left: 0, top: 0, right: 1000, bottom: 800 };

function hexCenterAt(hexKey: string): { x: number; y: number } | null {
  const [iRaw, jRaw] = hexKey.split(",");
  const i = Number(iRaw);
  const j = Number(jRaw);
  if (!Number.isFinite(i) || !Number.isFinite(j)) return null;
  return { x: 50 + i * 100, y: 50 + j * 100 };
}

describe("detectBorderDirection", () => {
  it("detects each cardinal edge", () => {
    expect(detectBorderDirection({ x: 500, y: 400 }, { x: 500, y: -10 }, bounds)).toBe(
      "north",
    );
    expect(detectBorderDirection({ x: 500, y: 400 }, { x: 500, y: 900 }, bounds)).toBe(
      "south",
    );
    expect(detectBorderDirection({ x: 500, y: 400 }, { x: 1100, y: 400 }, bounds)).toBe(
      "east",
    );
    expect(detectBorderDirection({ x: 500, y: 400 }, { x: -10, y: 400 }, bounds)).toBe(
      "west",
    );
  });

  it("uses dominant axis at corners", () => {
    expect(detectBorderDirection({ x: 500, y: 750 }, { x: 1100, y: 900 }, bounds)).toBe(
      "east",
    );
    expect(detectBorderDirection({ x: 500, y: 750 }, { x: 500, y: 950 }, bounds)).toBe(
      "south",
    );
  });

  it("returns null when destination stays inside", () => {
    expect(detectBorderDirection({ x: 100, y: 100 }, { x: 200, y: 200 }, bounds)).toBe(
      null,
    );
  });
});

describe("pointInBounds", () => {
  it("includes edge points", () => {
    expect(pointInBounds({ x: 0, y: 0 }, bounds)).toBe(true);
    expect(pointInBounds({ x: 1000, y: 800 }, bounds)).toBe(true);
    expect(pointInBounds({ x: 1001, y: 400 }, bounds)).toBe(false);
  });
});

describe("mapEntryHexKey", () => {
  it("maps south exit to north entry with closest lateral position", () => {
    const exitCenter = hexCenterAt("5,7");
    expect(exitCenter).not.toBeNull();
    const entry = mapEntryHexKey(exitCenter!, "south", bounds, hexCenterAt, {
      scanMin: 0,
      scanMax: 10,
      tolerance: 60,
    });
    expect(entry).toBe("5,0");
  });

  it("maps east exit to west entry with closest lateral position", () => {
    const exitCenter = hexCenterAt("9,3");
    expect(exitCenter).not.toBeNull();
    const entry = mapEntryHexKey(exitCenter!, "east", bounds, hexCenterAt, {
      scanMin: 0,
      scanMax: 10,
      tolerance: 60,
    });
    expect(entry).toBe("0,3");
  });

  it("uses exit center from the source scene grid, not the target grid", () => {
    const sourceHexCenterAt = (hexKey: string): { x: number; y: number } | null => {
      const center = hexCenterAt(hexKey);
      return center ? { x: center.x + 200, y: center.y + 150 } : null;
    };
    const exitCenter = sourceHexCenterAt("5,7");
    expect(exitCenter).not.toBeNull();
    const entry = mapEntryHexKey(exitCenter!, "south", bounds, hexCenterAt, {
      scanMin: 0,
      scanMax: 10,
      tolerance: 60,
    });
    expect(entry).toBe("7,0");
  });

  it("snaps projected border pixel to a hex on the active canvas grid", () => {
    const prevCanvas = (globalThis as { canvas?: unknown }).canvas;
    const grid = {
      isHexagonal: true,
      getOffset: ({ x, y }: { x: number; y: number }) => ({
        i: Math.round((x - 50) / 100),
        j: Math.round((y - 50) / 100),
      }),
      getTopLeftPoint: (coords: { x?: number; y?: number; i?: number; j?: number }) => {
        if (Number.isFinite(coords.i) && Number.isFinite(coords.j)) {
          return { x: coords.i! * 100, y: coords.j! * 100 };
        }
        const i = Math.round(((coords.x ?? 0) - 50) / 100);
        const j = Math.round(((coords.y ?? 0) - 50) / 100);
        return { x: i * 100, y: j * 100 };
      },
      pointToCube: ({ x, y }: { x: number; y: number }) => ({
        q: Math.round((x - 50) / 100),
        r: Math.round((y - 50) / 100),
        s: 0,
      }),
      cubeToOffset: ({ q, r }: { q: number; r: number }) => ({ i: q, j: r }),
    };
    (globalThis as { canvas?: unknown }).canvas = { grid };

    const exitCenter = { x: 750, y: 850 };
    const placement = resolveSceneEntryPlacement(
      "scene-test",
      exitCenter,
      "south",
      bounds,
      hexCenterAt,
      { scanMin: 0, scanMax: 10, tolerance: 60 },
    );
    expect(placement?.method).toBe("pixel");
    expect(placement?.hexKey).toBe("7,0");
    expect(placement?.x).toBe(700);

    (globalThis as { canvas?: unknown }).canvas = prevCanvas;
  });
});

describe("enumerateBorderHexKeys", () => {
  it("finds southern border hexes", () => {
    const keys = enumerateBorderHexKeys(bounds, "south", hexCenterAt, {
      scanMin: 0,
      scanMax: 10,
      tolerance: 60,
    });
    expect(keys).toContain("5,7");
    expect(keys.every((key) => Number(key.split(",")[1]) >= 7)).toBe(true);
  });
});

describe("resolveExitHexKey", () => {
  it("uses the last in-bounds hex along the movement path", () => {
    const prevCanvas = (globalThis as { canvas?: unknown }).canvas;
    (globalThis as { canvas?: unknown }).canvas = {
      scene: { id: "scene-test" },
      grid: {
        size: 100,
        getCenterPoint: ({ i, j }: { i: number; j: number }) => ({
          x: 50 + i * 100,
          y: 50 + j * 100,
        }),
      },
    };

    const doc = {
      x: 450,
      y: 650,
      width: 1,
      height: 1,
      getSize: () => ({ width: 100, height: 100 }),
      getOccupiedGridSpaceOffsets: ({ x, y }: { x: number; y: number }) => {
        const i = Math.round((x - 50) / 100);
        const j = Math.round((y - 50) / 100);
        return [{ i, j }];
      },
    };

    const movement = {
      origin: { x: 450, y: 650, width: 1, height: 1 },
      destination: { x: 450, y: 950, width: 1, height: 1 },
    };

    const exitHex = resolveExitHexKey(doc, movement, bounds, "scene-test");
    expect(exitHex).toBe("4,6");
    (globalThis as { canvas?: unknown }).canvas = prevCanvas;
  });
});

describe("readSceneBackgroundBounds", () => {
  it("uses sceneRect from getDimensions when canvas is unavailable", () => {
    const bounds = readSceneBackgroundBounds({
      id: "scene-1",
      getDimensions: () => ({
        sceneX: 200,
        sceneY: 150,
        sceneWidth: 1000,
        sceneHeight: 800,
        sceneRect: { x: 200, y: 150, width: 1000, height: 800 },
      }),
    });
    expect(bounds).toEqual({ left: 200, top: 150, right: 1200, bottom: 950 });
  });
});

describe("detectBorderCrossIntent", () => {
  it("detects crossing from passed waypoints when destination is absent", () => {
    const prevCanvas = (globalThis as { canvas?: unknown }).canvas;
    (globalThis as { canvas?: unknown }).canvas = {
      scene: { id: "scene-test" },
      grid: {
        size: 100,
        sizeY: 100,
        getCenterPoint: ({ i, j }: { i: number; j: number }) => ({
          x: 50 + i * 100,
          y: 50 + j * 100,
        }),
      },
    };

    const doc = {
      x: 450,
      y: 650,
      width: 1,
      height: 1,
      getSize: () => ({ width: 100, height: 100 }),
      getOccupiedGridSpaceOffsets: ({ x, y }: { x: number; y: number }) => {
        const i = Math.round((x - 50) / 100);
        const j = Math.round((y - 50) / 100);
        return [{ i, j }];
      },
    };

    const movement = {
      origin: { x: 450, y: 650, width: 1, height: 1 },
      passed: {
        waypoints: [{ x: 450, y: 950, width: 1, height: 1 }],
      },
    };

    const intent = detectBorderCrossIntent(
      { sceneLinks: { south: "scene-b" } },
      doc,
      movement,
      bounds,
      "scene-test",
    );

    expect(intent).toEqual({
      direction: "south",
      targetSceneId: "scene-b",
      exitHexKey: "4,6",
    });
    (globalThis as { canvas?: unknown }).canvas = prevCanvas;
  });
});

describe("buildCrossedSceneState", () => {
  it("copies journey progress and preserves target scene links", () => {
    const source = {
      ...defaultHexcrawlState("scene-a"),
      enabled: true,
      partyActorIds: ["pc-a", "pc-b"],
      navigatorActorId: "pc-a",
      hoursTraveledToday: 2.5,
      travelDay: 3,
      trailOverlayColor: "#112233",
      journeyLog: [{ at: 1, kind: "hexEntered" as const, travelDay: 3, hexKey: "1,1" }],
      sceneLinks: { south: "scene-b" },
      traveledHexKeys: ["0,0", "1,1"],
    };
    const targetExisting = {
      ...defaultHexcrawlState("scene-b"),
      sceneLinks: { north: "scene-a" },
      startingHexKey: "2,2",
    };

    const { state: next } = buildCrossedSceneState({
      source,
      targetSceneId: "scene-b",
      entryHexKey: "4,0",
      targetTokenId: "tok-b",
      targetExisting,
      fromSceneId: "scene-a",
      direction: "south",
    });

    expect(next.sceneId).toBe("scene-b");
    expect(next.partyActorIds).toEqual(["pc-a", "pc-b"]);
    expect(next.hoursTraveledToday).toBe(2.5);
    expect(next.travelDay).toBe(3);
    expect(next.trailOverlayColor).toBe("#112233");
    expect(next.traveledHexKeys).toEqual(["4,0"]);
    expect(next.sceneLinks).toEqual({ north: "scene-a" });
    expect(next.startingHexKey).toBe("2,2");
    expect(next.lastHexKey).toBe("4,0");
    expect(next.travelTokenId).toBe("tok-b");
    expect(next.journeyLog[0]?.kind).toBe("sceneCrossed");
  });

  it("restores the target scene trail when re-entering", () => {
    const source = {
      ...defaultHexcrawlState("scene-b"),
      enabled: true,
      traveledHexKeys: ["9,0"],
    };
    const targetExisting = {
      ...defaultHexcrawlState("scene-a"),
      traveledHexKeys: ["0,0", "1,1", "2,1"],
      startingHexKey: "0,0",
    };

    const { state: next } = buildCrossedSceneState({
      source,
      targetSceneId: "scene-a",
      entryHexKey: "3,0",
      targetTokenId: "tok-a",
      targetExisting,
      fromSceneId: "scene-b",
      direction: "north",
    });

    expect(next.traveledHexKeys).toEqual(["0,0", "1,1", "2,1", "3,0"]);
    expect(next.startingHexKey).toBe("0,0");
  });

  it("starts fresh trail on first visit when target trail was cleared", () => {
    expect(
      mergeTargetSceneTrail(
        { ...defaultHexcrawlState("scene-b"), trailCleared: true, traveledHexKeys: [] },
        "4,0",
      ),
    ).toEqual(["4,0"]);
  });

  it("detects destination arrival when border entry hex matches the map destination", () => {
    const source = {
      ...defaultHexcrawlState("scene-a"),
      enabled: true,
      traveledHexKeys: ["0,0"],
      hoursTraveledToday: 4,
      milesTraveledCumulative: 24,
      sceneLinks: { south: "scene-b" },
    };
    const targetExisting = {
      ...defaultHexcrawlState("scene-b"),
      startingHexKey: "0,0",
      mapDestination: { hexKey: "4,0", name: "Megaton" },
      sceneLinks: { north: "scene-a" },
    };

    const { state, destinationArrival } = buildCrossedSceneState({
      source,
      targetSceneId: "scene-b",
      entryHexKey: "4,0",
      targetTokenId: "tok-b",
      targetExisting,
      fromSceneId: "scene-a",
      direction: "south",
    });

    expect(destinationArrival).toEqual({ hexKey: "4,0", name: "Megaton" });
    expect(state.mapDestination).toBeNull();
    expect(state.startingHexKey).toBe("4,0");
    expect(state.lastHexKey).toBe("4,0");
    expect(state.hoursTraveledToday).toBe(0);
    expect(state.milesTraveledCumulative).toBe(0);
    expect(state.traveledHexKeys).toEqual(["4,0"]);
    expect(state.journeyLog.some((entry) => entry.kind === "destinationReached")).toBe(true);
    expect(state.journeyLog[0]?.kind).toBe("sceneCrossed");
  });
});
