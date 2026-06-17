import { describe, expect, it } from "vitest";
import { setHexCoverForEditor } from "./hexAnnotations.js";
import { defaultHexcrawlState } from "./hexcrawlScenePersist.js";

describe("hex cover paint stroke", () => {
  it("applies cover to multiple hexes in one in-memory pass", () => {
    const sceneId = "scene-paint";
    let state = defaultHexcrawlState(sceneId);
    const color = "#808080";

    for (const hexKey of ["1,1", "2,1", "3,1"]) {
      state = setHexCoverForEditor(state, hexKey, color);
    }

    expect(state.hexAnnotations["1,1"]?.hexCoverColor).toBe(color);
    expect(state.hexAnnotations["2,1"]?.hexCoverColor).toBe(color);
    expect(state.hexAnnotations["3,1"]?.hexCoverColor).toBe(color);
    expect(state.hexCoverBaseline["1,1"]).toBe(color);
    expect(state.hexCoverBaseline["3,1"]).toBe(color);
  });
});
