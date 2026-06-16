import { describe, expect, it } from "vitest";
import { defaultHexcrawlState } from "./hexcrawlScenePersist.js";
import {
  clearStagedHexcrawlMapOverlayState,
  resolveHexcrawlMapOverlayState,
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
    expect(resolveHexcrawlMapOverlayState(sceneId, caughtUp)).toEqual(caughtUp);
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
});
