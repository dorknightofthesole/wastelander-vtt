import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  collectMovementHexKeys,
  resolveEnteredHexKeys,
  resolveTokenLandingHexKey,
  sceneHexKeysForGridOverlay,
} from "./hexCoords.js";

type MockGrid = {
  size: number;
  sizeY: number;
  pointToCube: (point: { x: number; y: number }) => { q: number; r: number; s: number };
  cubeToOffset: (cube: { q: number; r: number; s: number }) => { i: number; j: number };
};

function installHexGrid(): void {
  const grid: MockGrid = {
    size: 100,
    sizeY: 100,
    pointToCube: ({ x, y }) => ({
      q: (x - 50) / 100,
      r: (y - 50) / 100,
      s: -((x - 50) / 100) - (y - 50) / 100,
    }),
    cubeToOffset: (cube) => ({
      i: Math.round(cube.q),
      j: Math.round(cube.r),
    }),
  };

  (globalThis as { canvas?: { grid?: MockGrid } }).canvas = { grid };
  (globalThis as { foundry?: { grid?: { HexagonalGrid?: { cubeRound: (c: typeof cube) => typeof cube } } } }).foundry = {
    grid: {
      HexagonalGrid: {
        cubeRound: (cube) => ({
          q: Math.round(cube.q),
          r: Math.round(cube.r),
          s: Math.round(cube.s),
        }),
      },
    },
  };
}


describe("collectMovementHexKeys", () => {
  beforeEach(() => installHexGrid());
  afterEach(() => {
    delete (globalThis as { canvas?: unknown }).canvas;
    delete (globalThis as { foundry?: unknown }).foundry;
  });

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

  it("reads v13 passed.waypoints paths", () => {
    const keys = collectMovementHexKeys(doc, {
      origin: { x: 450, y: 650, width: 1, height: 1 },
      passed: {
        waypoints: [{ x: 450, y: 950, width: 1, height: 1 }],
      },
    });
    expect(keys).toEqual(["4,9"]);
  });

  it("falls back to origin and destination when passed is empty", () => {
    const keys = collectMovementHexKeys(doc, {
      origin: { x: 450, y: 650, width: 1, height: 1 },
      destination: { x: 450, y: 950, width: 1, height: 1 },
    });
    expect(keys).toEqual(["4,6", "4,9"]);
  });

  it("reads history paths when passed is absent", () => {
    const keys = collectMovementHexKeys(doc, {
      history: {
        waypoints: [{ x: 450, y: 950, width: 1, height: 1 }],
      },
    });
    expect(keys).toEqual(["4,9"]);
  });
});

describe("sceneHexKeysForGridOverlay", () => {
  afterEach(() => {
    delete (globalThis as { canvas?: unknown }).canvas;
  });

  it("returns hex keys from grid offset range", () => {
    (globalThis as { canvas?: unknown }).canvas = {
      dimensions: { width: 3000, height: 2000, sceneRect: { x: 0, y: 0, width: 3000, height: 2000 } },
      grid: {
        isHexagonal: true,
        size: 100,
        getOffsetRange: () => [0, 0, 2, 2],
      },
    };

    expect(sceneHexKeysForGridOverlay().sort()).toEqual(["0,0", "0,1", "1,0", "1,1"]);
  });
});

describe("resolveTokenLandingHexKey", () => {
  beforeEach(() => installHexGrid());
  afterEach(() => {
    delete (globalThis as { canvas?: unknown }).canvas;
    delete (globalThis as { foundry?: unknown }).foundry;
  });

  it("uses the token document position after the move", () => {
    const doc = {
      x: 450,
      y: 950,
      width: 1,
      height: 1,
      getSize: () => ({ width: 100, height: 100 }),
      getOccupiedGridSpaceOffsets: ({ x, y }: { x: number; y: number }) => {
        const i = Math.round((x - 50) / 100);
        const j = Math.round((y - 50) / 100);
        return [{ i, j }];
      },
    };

    expect(resolveTokenLandingHexKey(doc, {})).toBe("4,9");
  });

  it("falls back to movement destination when the document position cannot resolve", () => {
    const doc = {
      x: Number.NaN,
      y: Number.NaN,
      width: 1,
      height: 1,
      getSize: () => ({ width: 100, height: 100 }),
      getOccupiedGridSpaceOffsets: ({ x, y }: { x: number; y: number }) => {
        const i = Math.round((x - 50) / 100);
        const j = Math.round((y - 50) / 100);
        return [{ i, j }];
      },
    };

    const keys = resolveEnteredHexKeys(doc, {
      destination: { x: 450, y: 950, width: 1, height: 1 },
    });
    expect(keys).toContain("4,9");
    expect(resolveTokenLandingHexKey(doc, {
      destination: { x: 450, y: 950, width: 1, height: 1 },
    })).toBe("4,9");
  });
});
