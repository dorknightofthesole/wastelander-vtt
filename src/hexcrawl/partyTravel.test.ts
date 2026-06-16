import { describe, expect, it } from "vitest";
import { mergePartyActorIdsWithScene } from "./partyTravel.js";
import {
  formatMphWithUnit,
  hexTravelMinutes,
  mphForAgi,
  mphForAgiAndTerrain,
  travelEncounterRollCount,
} from "./travelRules.js";

describe("mergePartyActorIdsWithScene", () => {
  it("uses all scene PCs when the stored party is empty", () => {
    expect(mergePartyActorIdsWithScene([], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("adds missing scene PCs without removing stored members", () => {
    expect(mergePartyActorIdsWithScene(["a"], ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("keeps stored party when scene has no linked PCs", () => {
    expect(mergePartyActorIdsWithScene(["a", "b"], [])).toEqual(["a", "b"]);
  });
});

describe("travel timing and encounters", () => {
  it("computes 15 minutes for 0.5 mi at 2 mph", () => {
    expect(hexTravelMinutes(0.5, 2)).toBe(15);
  });

  it("rolls encounters on hour boundaries in hourChange mode", () => {
    expect(
      travelEncounterRollCount("hourChange", 0.5, 0.75, { onHexEntry: true }),
    ).toBe(0);
    expect(
      travelEncounterRollCount("hourChange", 0.75, 1.25, { onHexEntry: true }),
    ).toBe(1);
  });

  it("rolls once per hex in hexEntry mode regardless of mph", () => {
    expect(
      travelEncounterRollCount("hexEntry", 0, 0.25, { onHexEntry: true }),
    ).toBe(1);
    expect(
      travelEncounterRollCount("hexEntry", 0, 0.25, { onHexEntry: false }),
    ).toBe(0);
  });

  it("formats speed with MPH initials", () => {
    expect(formatMphWithUnit(2)).toBe("2 MPH");
    expect(formatMphWithUnit(1.5)).toBe("1.5 MPH");
  });

  it("maps low AGI to 2 mph on normal terrain", () => {
    expect(mphForAgi(5)).toBe(2);
    expect(mphForAgi(6)).toBe(3);
  });

  it("uses GM Toolkit terrain table by AGI band", () => {
    expect(mphForAgiAndTerrain(5, "open")).toBe(3);
    expect(mphForAgiAndTerrain(5, "rough")).toBe(1.5);
    expect(mphForAgiAndTerrain(5, "hard")).toBe(1);
    expect(mphForAgiAndTerrain(7, "open")).toBe(4.5);
    expect(mphForAgiAndTerrain(7, "rough")).toBe(2.25);
    expect(mphForAgiAndTerrain(10, "hard")).toBe(2);
  });
});
