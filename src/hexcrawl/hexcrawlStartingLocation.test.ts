import { describe, expect, it } from "vitest";
import { defaultHexcrawlState } from "./hexcrawlScenePersist.js";
import { applyResetMap } from "./resetHexMap.js";
import {
  explainStartingLocationPromptSkip,
  shouldOfferStartingLocationPrompt,
} from "./hexcrawlStartingLocation.js";

describe("first-token starting location prompt", () => {
  const sceneId = "scene-first-token";

  it("offers when hexcrawl is enabled, no start hex, and this is the only token", () => {
    const state = { ...defaultHexcrawlState(sceneId), enabled: true };
    expect(shouldOfferStartingLocationPrompt(state, 1)).toBe(true);
  });

  it("does not offer when starting hex is already set", () => {
    const state = {
      ...defaultHexcrawlState(sceneId),
      enabled: true,
      startingHexKey: "5,5",
    };
    expect(shouldOfferStartingLocationPrompt(state, 1)).toBe(false);
  });

  it("offers again after reset map clears starting hex", () => {
    const beforeReset = {
      ...defaultHexcrawlState(sceneId),
      enabled: true,
      startingHexKey: "0,0",
      lastHexKey: "2,2",
      travelTokenId: "tok-1",
    };
    expect(shouldOfferStartingLocationPrompt(beforeReset, 1)).toBe(false);

    const afterReset = applyResetMap(beforeReset);
    expect(afterReset.startingHexKey).toBeNull();
    expect(shouldOfferStartingLocationPrompt(afterReset, 1)).toBe(true);
  });

  it("does not offer when hexcrawl is disabled", () => {
    const state = { ...defaultHexcrawlState(sceneId), enabled: false };
    expect(shouldOfferStartingLocationPrompt(state, 1)).toBe(false);
  });

  it("does not offer when other tokens already exist on the scene", () => {
    const state = { ...defaultHexcrawlState(sceneId), enabled: true };
    expect(shouldOfferStartingLocationPrompt(state, 2)).toBe(false);
  });

  it("does not offer when state is missing", () => {
    expect(shouldOfferStartingLocationPrompt(null, 1)).toBe(false);
    expect(explainStartingLocationPromptSkip(null, 1)).toBe("no hexcrawl scene state");
  });

  it("explains skip reasons for each guard", () => {
    expect(
      explainStartingLocationPromptSkip(
        { ...defaultHexcrawlState(sceneId), enabled: false },
        1,
      ),
    ).toBe("hexcrawl not enabled on scene");
    expect(
      explainStartingLocationPromptSkip(
        { ...defaultHexcrawlState(sceneId), enabled: true, startingHexKey: "1,1" },
        1,
      ),
    ).toBe("starting hex already set (1,1)");
    expect(
      explainStartingLocationPromptSkip(
        { ...defaultHexcrawlState(sceneId), enabled: true },
        2,
      ),
    ).toBe("scene token count is 2, expected 1");
    expect(
      explainStartingLocationPromptSkip(
        { ...defaultHexcrawlState(sceneId), enabled: true },
        1,
      ),
    ).toBeNull();
  });
});
