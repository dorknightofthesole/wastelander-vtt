import { describe, expect, it } from "vitest";
import {
  defaultHexcrawlState,
  normalizeHexcrawlState,
  prepareHexcrawlStateForSave,
} from "./hexcrawlScenePersist.js";

describe("normalizeHexcrawlState v2 repair", () => {
  it("merges orphaned world journey data into v2 scene-local flags", () => {
    const sceneId = "scene-1";
    const sceneFlag = {
      version: 2,
      sceneId,
      enabled: true,
      lastHexKey: "1,1",
      startingHexKey: "0,0",
      traveledHexKeys: ["0,0", "1,1"],
      trailOverlayColor: "#863e0e",
      trailCleared: false,
      sceneLinks: {},
      travelTokenId: "tok-1",
      resetTravelPending: null,
      updatedAt: 1,
    };
    const worldJourney = {
      version: 1,
      partyActorIds: ["pc-a", "pc-b"],
      navigatorActorId: "pc-a",
      hoursTraveledToday: 1.25,
      journeyLog: [{ at: 1, kind: "hexEntered", travelDay: 1, hexKey: "1,1" }],
      travelEventMode: "hourChange",
      activeSceneId: sceneId,
    };

    const game = globalThis.game as {
      scenes?: { get: (id: string) => { getFlag?: (scope: string, key: string) => unknown } | undefined };
      world?: { getFlag?: (scope: string, key: string) => unknown };
    };
    game.scenes = {
      get: (id: string) => (id === sceneId ? { getFlag: () => sceneFlag } : undefined),
    };
    game.world = { getFlag: () => worldJourney };

    const state = normalizeHexcrawlState(sceneFlag, sceneId);
    expect(state.partyActorIds).toEqual(["pc-a", "pc-b"]);
    expect(state.hoursTraveledToday).toBe(1.25);
    expect(state.journeyLog).toHaveLength(1);
    expect(state.travelTokenId).toBe("tok-1");
    expect(state.sceneLinks).toEqual({});
  });
});

describe("normalizeHexcrawlState sceneLinks", () => {
  it("preserves valid scene link ids on v1 state", () => {
    const sceneId = "scene-1";
    const raw = {
      ...defaultHexcrawlState(sceneId),
      enabled: true,
      sceneLinks: { south: "scene-2", east: "", north: "scene-3" },
    };

    const game = globalThis.game as {
      scenes?: { get: (id: string) => { getFlag?: (scope: string, key: string) => unknown } | undefined };
      world?: { getFlag?: (scope: string, key: string) => unknown };
    };
    game.scenes = { get: () => undefined };
    game.world = { getFlag: () => null };

    const state = normalizeHexcrawlState(raw, sceneId);
    expect(state.sceneLinks).toEqual({ south: "scene-2", north: "scene-3" });
  });
});

describe("prepareHexcrawlStateForSave", () => {
  it("keeps fresher travel hours when the app state is stale", () => {
    const sceneId = "scene-1";
    const fresh = {
      ...defaultHexcrawlState(sceneId),
      hoursTraveledToday: 1.5,
      journeyLog: [{ at: 1, kind: "hexEntered" as const, travelDay: 1 }],
      partyActorIds: ["pc-a", "pc-b"],
      navigatorActorId: "pc-a",
    };
    const staleApp = {
      ...defaultHexcrawlState(sceneId),
      travelEventMode: "hourChange" as const,
      hoursTraveledToday: 0,
      journeyLog: [] as typeof fresh.journeyLog,
      partyActorIds: ["pc-a", "pc-b"],
    };

    const sceneFlag = { ...fresh, version: 1 as const };
    const game = globalThis.game as {
      scenes?: { get: (id: string) => { getFlag?: (scope: string, key: string) => unknown } | undefined };
      world?: { getFlag?: (scope: string, key: string) => unknown };
    };
    game.scenes = {
      get: (id: string) => (id === sceneId ? { getFlag: () => sceneFlag } : undefined),
    };
    game.world = { getFlag: () => null };

    const merged = prepareHexcrawlStateForSave(staleApp, sceneId);
    expect(merged.hoursTraveledToday).toBe(1.5);
    expect(merged.travelEventMode).toBe("hourChange");
    expect(merged.journeyLog).toHaveLength(1);
  });

  it("keeps enabled true when UI toggles on a scene with an existing flag", () => {
    const sceneId = "scene-1";
    const fresh = {
      ...defaultHexcrawlState(sceneId),
      enabled: false,
      journeyLog: [],
    };
    const pending = {
      ...fresh,
      enabled: true,
      journeyLog: [{ at: 1, kind: "enabled" as const, travelDay: 1 }],
    };

    const game = globalThis.game as {
      scenes?: { get: (id: string) => { getFlag?: (scope: string, key: string) => unknown } | undefined };
      world?: { getFlag?: (scope: string, key: string) => unknown };
    };
    game.scenes = {
      get: (id: string) =>
        id === sceneId ? { getFlag: () => ({ ...fresh, version: 1 }) } : undefined,
    };
    game.world = { getFlag: () => null };

    const merged = prepareHexcrawlStateForSave(pending, sceneId);
    expect(merged.enabled).toBe(true);
    expect(merged.journeyLog).toHaveLength(1);
  });
});
