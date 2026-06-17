import { describe, expect, it } from "vitest";
import { defaultHexcrawlState } from "./hexcrawlScenePersist.js";
import {
  clearStagedHexcrawlMapOverlayState,
  resolveHexcrawlMapOverlayState,
  resolveMapFogRevealAll,
  setHexcrawlMapPlayerPreview,
  stageHexcrawlMapOverlayState,
} from "./hexMapOverlayState.js";

describe("hexMapOverlayState", () => {
  it("prefers staged travel state but keeps map annotations from the scene flag", () => {
    const sceneId = "scene-a";
    const loaded = {
      ...defaultHexcrawlState(sceneId),
      updatedAt: 100,
      hexAnnotations: {},
      hexCoverBaseline: {},
    };
    const staged = {
      ...loaded,
      updatedAt: 200,
      traveledHexKeys: ["1,1", "2,2"],
      hexAnnotations: { "1,1": { hexCoverColor: "#808080" as const } },
    };

    stageHexcrawlMapOverlayState(staged);
    expect(resolveHexcrawlMapOverlayState(sceneId, loaded)).toEqual({
      ...staged,
      hexAnnotations: {},
      hexCoverBaseline: {},
      hiddenTrailHexKeys: [],
      showTerrainIcons: true,
      showHexCoords: false,
    });

    const sameTimestamp = {
      ...loaded,
      updatedAt: 200,
      hexAnnotations: { "3,3": { iconId: "camp" as const } },
    };
    expect(resolveHexcrawlMapOverlayState(sceneId, sameTimestamp)).toEqual({
      ...staged,
      hexAnnotations: { "3,3": { iconId: "camp" } },
      hiddenTrailHexKeys: [],
      showTerrainIcons: true,
      showHexCoords: false,
    });

    const caughtUp = { ...staged, updatedAt: 250, hexAnnotations: {} };
    expect(resolveHexcrawlMapOverlayState(sceneId, caughtUp)).toEqual(caughtUp);
  });

  it("keeps showHexCoords from staged UI when the scene flag is older", () => {
    const sceneId = "scene-c";
    const loaded = {
      ...defaultHexcrawlState(sceneId),
      updatedAt: 100,
      showHexCoords: false,
    };
    const staged = {
      ...loaded,
      updatedAt: 200,
      showHexCoords: true,
    };

    stageHexcrawlMapOverlayState(staged);
    expect(resolveHexcrawlMapOverlayState(sceneId, loaded)?.showHexCoords).toBe(true);
  });

  it("keeps the longer visited trail when staged is ahead of the scene flag", () => {
    const sceneId = "scene-d";
    const loaded = {
      ...defaultHexcrawlState(sceneId),
      updatedAt: 100,
      traveledHexKeys: [],
      trailCleared: true,
    };
    const staged = {
      ...loaded,
      updatedAt: 200,
      traveledHexKeys: ["0,0", "1,1", "4,4"],
      trailCleared: false,
      startingHexKey: "4,4",
      lastHexKey: "4,4",
    };

    stageHexcrawlMapOverlayState(staged);
    const resolved = resolveHexcrawlMapOverlayState(sceneId, loaded);
    expect(resolved?.traveledHexKeys).toEqual(["0,0", "1,1", "4,4"]);
    expect(resolved?.trailCleared).toBe(false);
  });

  it("clears staged state by scene id", () => {
    const sceneId = "scene-b";
    const state = {
      ...defaultHexcrawlState(sceneId),
      updatedAt: 500,
    };
    stageHexcrawlMapOverlayState(state);
    clearStagedHexcrawlMapOverlayState(sceneId);
    expect(resolveHexcrawlMapOverlayState(sceneId, null)).toBeNull();
  });

  it("resolves map fog reveal for overseer player preview", () => {
    setHexcrawlMapPlayerPreview(false);
    expect(resolveMapFogRevealAll(true)).toBe(true);
    expect(resolveMapFogRevealAll(false)).toBe(false);

    setHexcrawlMapPlayerPreview(true);
    expect(resolveMapFogRevealAll(true)).toBe(false);
    expect(resolveMapFogRevealAll(false)).toBe(false);

    setHexcrawlMapPlayerPreview(false);
  });
});
