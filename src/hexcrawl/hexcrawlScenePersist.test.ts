import { describe, expect, it } from "vitest";
import { MODULE_ID } from "../constants.js";
import {
  defaultHexcrawlState,
  HEXCRAWL_HEX_MAP_FLAG,
  HEXCRAWL_SCENE_STATE_FLAG,
  loadHexcrawlSceneState,
  normalizeHexcrawlState,
  prepareHexcrawlStateForSave,
  saveHexcrawlSceneState,
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

  it("keeps camp day-end progress when stale UI still has prior hours", () => {
    const sceneId = "scene-1";
    const fresh = {
      ...defaultHexcrawlState(sceneId),
      travelDay: 2,
      hoursTraveledToday: 0,
      journeyLog: [
        { at: 1, kind: "hexEntered" as const, travelDay: 1, hexKey: "1,1" },
        { at: 2, kind: "campEncounter" as const, travelDay: 1 },
        { at: 3, kind: "dayEnded" as const, travelDay: 1 },
        { at: 4, kind: "campSet" as const, travelDay: 2 },
      ],
    };
    const staleApp = {
      ...defaultHexcrawlState(sceneId),
      travelDay: 1,
      hoursTraveledToday: 6.5,
      journeyLog: [{ at: 1, kind: "hexEntered" as const, travelDay: 1, hexKey: "1,1" }],
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

    const merged = prepareHexcrawlStateForSave(staleApp, sceneId);
    expect(merged.travelDay).toBe(2);
    expect(merged.hoursTraveledToday).toBe(0);
    expect(merged.journeyLog).toHaveLength(4);
  });

  it("keeps an explicit journal clear over a longer on-disk log", () => {
    const sceneId = "scene-1";
    const fresh = {
      ...defaultHexcrawlState(sceneId),
      journeyLog: [
        { at: 1, kind: "hexEntered" as const, travelDay: 1, hexKey: "1,1" },
        { at: 2, kind: "encounter" as const, travelDay: 1 },
      ],
      traveledHexKeys: ["1,1"],
      trailCleared: false,
    };
    const clearedApp = {
      ...defaultHexcrawlState(sceneId),
      travelDay: 2,
      hoursTraveledToday: 1.5,
      journeyLog: [] as typeof fresh.journeyLog,
      traveledHexKeys: [] as string[],
      trailCleared: true,
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

    const merged = prepareHexcrawlStateForSave(clearedApp, sceneId);
    expect(merged.journeyLog).toEqual([]);
    expect(merged.traveledHexKeys).toEqual([]);
    expect(merged.trailCleared).toBe(true);
    expect(merged.travelDay).toBe(2);
    expect(merged.hoursTraveledToday).toBe(1.5);
  });

  it("keeps reset travel trail shrink over a longer on-disk trail", () => {
    const sceneId = "scene-1";
    const fresh = {
      ...defaultHexcrawlState(sceneId),
      enabled: true,
      startingHexKey: "0,0",
      traveledHexKeys: ["0,0", "1,1", "2,2", "3,3"],
      journeyLog: [
        { at: 3, kind: "hexEntered" as const, travelDay: 2, hexKey: "3,3" },
        { at: 2, kind: "hexEntered" as const, travelDay: 1, hexKey: "2,2" },
      ],
      travelDay: 2,
      hoursTraveledToday: 4,
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

    const resetPending = {
      ...fresh,
      hoursTraveledToday: 0,
      travelDay: 1,
      lastHexKey: "0,0",
      traveledHexKeys: ["0,0"],
      trailCleared: false,
      resetTravelPending: { tokenId: "tok-1", untilHexKey: "0,0" },
      journeyLog: [
        { at: 4, kind: "travelReset" as const, travelDay: 1, hexKey: "0,0", note: "0,0" },
        ...fresh.journeyLog,
      ],
    };

    const merged = prepareHexcrawlStateForSave(resetPending, sceneId);
    expect(merged.traveledHexKeys).toEqual(["0,0"]);
    expect(merged.journeyLog[0]?.kind).toBe("travelReset");
    expect(merged.travelDay).toBe(1);
    expect(merged.hoursTraveledToday).toBe(0);
  });

  it("preserves hex annotations from pending UI edits", () => {
    const sceneId = "scene-1";
    const fresh = {
      ...defaultHexcrawlState(sceneId),
      hexAnnotations: {},
      hiddenTrailHexKeys: [],
    };
    const pending = {
      ...fresh,
      hexAnnotations: { "2,2": { terrain: "rough" as const, iconId: "camp" } },
      hiddenTrailHexKeys: ["1,1"],
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
    expect(merged.hexAnnotations).toEqual({ "2,2": { terrain: "rough", iconId: "camp" } });
    expect(merged.hiddenTrailHexKeys).toEqual(["1,1"]);
  });

  it("preserves cleared hex annotations from pending UI edits", () => {
    const sceneId = "scene-1";
    const fresh = {
      ...defaultHexcrawlState(sceneId),
      hexAnnotations: { "2,2": { iconId: "camp" as const } },
      journeyLog: [{ kind: "travel" as const, travelDay: 1, at: 1 }],
    };
    const pending = {
      ...defaultHexcrawlState(sceneId),
      hexAnnotations: {},
      journeyLog: [],
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
    expect(merged.hexAnnotations).toEqual({});
  });

  it("preserves cleared inherited destination cache over stale on-disk value", () => {
    const sceneId = "dest-scene";
    const staleInherited = {
      name: "Megaton",
      hexKey: "0,0",
      sourceSceneId: "scene-south",
      sourceSceneName: "Southern Wastes",
    };
    const fresh = {
      ...defaultHexcrawlState(sceneId),
      mapDestination: { hexKey: "5,5", name: "Local Goal" },
      inheritedProgressDestination: staleInherited,
    };
    const pending = {
      ...fresh,
      inheritedProgressDestination: null as typeof staleInherited | null,
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
    expect(merged.inheritedProgressDestination).toBeNull();
    expect(merged.mapDestination).toEqual({ hexKey: "5,5", name: "Local Goal" });
  });

  it("clears mapDestinationReached when pending clears the destination marker", () => {
    const sceneId = "dest-scene";
    const fresh = {
      ...defaultHexcrawlState(sceneId),
      mapDestination: { hexKey: "4,4", name: "Settlement" },
      mapDestinationReached: true,
      traveledHexKeys: ["0,0", "4,4"],
    };
    const pending = {
      ...fresh,
      mapDestination: null as typeof fresh.mapDestination,
      mapDestinationReached: false,
      lastHexKey: "0,0",
      journeyLog: [
        { at: 2, kind: "destinationReached" as const, travelDay: 1, hexKey: "4,4", note: "Settlement" },
        ...fresh.journeyLog,
      ],
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
    expect(merged.mapDestination).toBeNull();
    expect(merged.mapDestinationReached).toBe(false);
  });

  it("preserves zeroed hours and miles when saving destination arrival", () => {
    const sceneId = "dest-scene";
    const fresh = {
      ...defaultHexcrawlState(sceneId),
      mapDestination: { hexKey: "4,4", name: "Settlement" },
      hoursTraveledToday: 6,
      milesTraveledCumulative: 42,
      traveledHexKeys: ["0,0", "4,4"],
    };
    const pending = {
      ...fresh,
      mapDestination: null as typeof fresh.mapDestination,
      mapDestinationReached: false,
      hoursTraveledToday: 0,
      milesTraveledCumulative: 0,
      startingHexKey: "4,4",
      lastHexKey: "4,4",
      journeyLog: [
        { at: 2, kind: "destinationReached" as const, travelDay: 1, hexKey: "4,4", note: "Settlement" },
      ],
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
    expect(merged.hoursTraveledToday).toBe(0);
    expect(merged.milesTraveledCumulative).toBe(0);
    expect(merged.startingHexKey).toBe("4,4");
    expect(merged.lastHexKey).toBe("4,4");
    expect(merged.traveledHexKeys).toEqual(["0,0", "4,4"]);
  });
});

describe("hexcrawlHexMap flag", () => {
  it("persists cleared icons through save and reload", async () => {
    const sceneId = "scene-map";
    const flags: Record<string, Record<string, unknown>> = {
      [MODULE_ID]: {},
    };
    const scene = {
      unsetFlag: async (scope: string, key: string) => {
        if (flags[scope]) delete flags[scope][key];
      },
      setFlag: async (
        scope: string,
        key: string,
        value: unknown,
        options?: { merge?: boolean },
      ) => {
        if (!flags[scope]) flags[scope] = {};
        flags[scope][key] =
          options?.merge === false
            ? structuredClone(value)
            : { ...(flags[scope][key] as object), ...(value as object) };
      },
      getFlag: (scope: string, key: string) => flags[scope]?.[key],
    };

    const game = globalThis.game as {
      scenes?: { get: (id: string) => typeof scene | undefined };
      world?: { getFlag?: (scope: string, key: string) => unknown };
    };
    game.scenes = { get: (id) => (id === sceneId ? scene : undefined) };
    game.world = { getFlag: () => null, unsetFlag: async () => undefined };

    const withIcon = {
      ...defaultHexcrawlState(sceneId),
      enabled: true,
      hexAnnotations: { "4,4": { iconId: "ruins" as const } },
    };
    await saveHexcrawlSceneState(withIcon);

    const cleared = {
      ...withIcon,
      hexAnnotations: {},
      updatedAt: withIcon.updatedAt + 1000,
    };
    await saveHexcrawlSceneState(cleared);

    const loaded = loadHexcrawlSceneState(sceneId);
    expect(loaded?.hexAnnotations).toEqual({});

    const mainRaw = flags[MODULE_ID][HEXCRAWL_SCENE_STATE_FLAG] as {
      hexAnnotations?: Record<string, unknown>;
    };
    const mapRaw = flags[MODULE_ID][HEXCRAWL_HEX_MAP_FLAG] as {
      hexAnnotations?: Record<string, unknown>;
    };
    expect(mapRaw.hexAnnotations).toEqual({});
    expect(mainRaw.hexAnnotations).toEqual({});
  });

  it("persists hex cover removal after travel entry", async () => {
    const sceneId = "scene-cover-travel";
    const flags: Record<string, Record<string, unknown>> = { [MODULE_ID]: {} };

    const scene = {
      unsetFlag: async (scope: string, key: string) => {
        if (flags[scope]) delete flags[scope][key];
      },
      setFlag: async (
        scope: string,
        key: string,
        value: unknown,
        options?: { merge?: boolean },
      ) => {
        if (!flags[scope]) flags[scope] = {};
        flags[scope][key] =
          options?.merge === false
            ? structuredClone(value)
            : { ...(flags[scope][key] as object), ...(value as object) };
      },
      getFlag: (scope: string, key: string) => flags[scope]?.[key],
    };

    const game = globalThis.game as {
      scenes?: { get: (id: string) => typeof scene | undefined };
      world?: { getFlag?: (scope: string, key: string) => unknown };
    };
    game.scenes = { get: (id) => (id === sceneId ? scene : undefined) };
    game.world = { getFlag: () => null, unsetFlag: async () => undefined };

    const withCover = {
      ...defaultHexcrawlState(sceneId),
      enabled: true,
      hexAnnotations: { "5,5": { hexCoverColor: "#808080" } },
    };
    await saveHexcrawlSceneState(withCover);

    const afterEntry = {
      ...withCover,
      hexAnnotations: {},
      lastHexKey: "5,5",
    };
    await saveHexcrawlSceneState(afterEntry);

    const loaded = loadHexcrawlSceneState(sceneId);
    expect(loaded?.hexAnnotations["5,5"]).toBeUndefined();
    expect(
      (flags[MODULE_ID][HEXCRAWL_HEX_MAP_FLAG] as { hexAnnotations?: Record<string, unknown> })
        .hexAnnotations,
    ).toEqual({});
  });

  it("prefers dedicated hex map flag when it is at least as new as scene state", () => {
    const sceneId = "scene-map";
    const scene = {
      getFlag: (scope: string, key: string) => {
        if (scope !== MODULE_ID) return undefined;
        if (key === HEXCRAWL_SCENE_STATE_FLAG) {
          return {
            ...defaultHexcrawlState(sceneId),
            enabled: true,
            hexAnnotations: { "1,1": { iconId: "camp" } },
            updatedAt: 2,
            version: 1,
          };
        }
        if (key === HEXCRAWL_HEX_MAP_FLAG) {
          return {
            hexAnnotations: {},
            hiddenTrailHexKeys: [],
            showTerrainIcons: true,
            updatedAt: 2,
          };
        }
        return undefined;
      },
    };

    const game = globalThis.game as {
      scenes?: { get: (id: string) => typeof scene | undefined };
      world?: { getFlag?: (scope: string, key: string) => unknown };
    };
    game.scenes = { get: (id) => (id === sceneId ? scene : undefined) };
    game.world = { getFlag: () => null };

    const loaded = loadHexcrawlSceneState(sceneId);
    expect(loaded?.hexAnnotations).toEqual({});
  });

  it("always applies the dedicated hex map flag when present", () => {
    const sceneId = "scene-stale-map";
    const scene = {
      getFlag: (scope: string, key: string) => {
        if (scope !== MODULE_ID) return undefined;
        if (key === HEXCRAWL_SCENE_STATE_FLAG) {
          return {
            ...defaultHexcrawlState(sceneId),
            enabled: true,
            updatedAt: 200,
            version: 1,
          };
        }
        if (key === HEXCRAWL_HEX_MAP_FLAG) {
          return {
            hexAnnotations: { "9,9": { hexCoverColor: "#808080" } },
            hiddenTrailHexKeys: [],
            showTerrainIcons: true,
            updatedAt: 100,
          };
        }
        return undefined;
      },
    };

    const game = globalThis.game as {
      scenes?: { get: (id: string) => typeof scene | undefined };
      world?: { getFlag?: (scope: string, key: string) => unknown };
    };
    game.scenes = { get: (id) => (id === sceneId ? scene : undefined) };
    game.world = { getFlag: () => null };

    const loaded = loadHexcrawlSceneState(sceneId);
    expect(loaded?.hexAnnotations["9,9"]).toEqual({ hexCoverColor: "#808080" });
  });
});
