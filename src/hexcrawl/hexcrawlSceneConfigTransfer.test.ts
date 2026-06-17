import { describe, expect, it } from "vitest";
import { restoreHexCoversFromBaseline } from "./hexAnnotations.js";
import { defaultHexcrawlState, HEXCRAWL_HEX_MAP_FLAG, loadHexcrawlSceneState } from "./hexcrawlScenePersist.js";
import {
  createFoundryFlagScene,
  MODULE_ID,
} from "./foundryFlagTestMock.js";
import {
  applyMapConfigImport,
  buildSceneMapConfig,
  collectLinkedSceneIds,
  HEXCRAWL_CONFIG_EXPORT_VERSION,
  importHexcrawlConfigForScene,
  parseHexcrawlConfigBundle,
  sceneLinksFromNames,
  sceneLinksToNames,
} from "./hexcrawlSceneConfigTransfer.js";

describe("buildSceneMapConfig", () => {
  it("includes map editor fields and omits runtime party and travel state", () => {
    const sceneId = "scene-1";
    const state = {
      ...defaultHexcrawlState(sceneId),
      enabled: true,
      terrainType: "rough" as const,
      startingHexKey: "2,3",
      trailOverlayColor: "#aabbcc",
      sceneLinks: { north: "scene-2" },
      hexAnnotations: { "1,1": { terrain: "hard", iconId: "ruins" } },
      hexCoverBaseline: { "1,1": "#112233" },
      hiddenTrailHexKeys: ["0,0"],
      showHexCoords: true,
      partyActorIds: ["actor-1"],
      navigatorActorId: "actor-1",
      travelTokenId: "tok-1",
      journeyLog: [{ at: 1, kind: "hexEntered" as const, travelDay: 1 }],
      traveledHexKeys: ["0,0", "1,1"],
      mapDestination: { hexKey: "5,5", name: "Vault" },
      discoveredPoiHexKeys: ["1,1"],
      hoursTraveledToday: 4,
      milesTraveledCumulative: 12,
    };

    const config = buildSceneMapConfig(state, { north: "Northern Map" });

    expect(config.enabled).toBe(true);
    expect(config.terrainType).toBe("rough");
    expect(config.startingHexKey).toBe("2,3");
    expect(config.trailOverlayColor).toBe("#aabbcc");
    expect(config.sceneLinks).toEqual({ north: "Northern Map" });
    expect(config.hexAnnotations).toEqual({
      "1,1": { terrain: "hard", iconId: "ruins", hexCoverColor: "#112233" },
    });
    expect(config.hexCoverBaseline).toEqual({ "1,1": "#112233" });
    expect(config.hiddenTrailHexKeys).toEqual(["0,0"]);
    expect(config.showHexCoords).toBe(true);

    expect(config).not.toHaveProperty("partyActorIds");
    expect(config).not.toHaveProperty("journeyLog");
    expect(config).not.toHaveProperty("traveledHexKeys");
    expect(config).not.toHaveProperty("mapDestination");
  });
});

describe("applyMapConfigImport", () => {
  it("overwrites map config while preserving party, history, trail, and destinations", () => {
    const sceneId = "scene-1";
    const existing = {
      ...defaultHexcrawlState(sceneId),
      enabled: false,
      terrainType: "normal" as const,
      partyActorIds: ["actor-1"],
      navigatorActorId: "actor-1",
      travelTokenId: "tok-1",
      hoursTraveledToday: 3,
      travelDay: 2,
      lastHexKey: "4,4",
      journeyLog: [{ at: 1, kind: "hexEntered" as const, travelDay: 2, hexKey: "4,4" }],
      traveledHexKeys: ["3,3", "4,4"],
      trailCleared: true,
      discoveredPoiHexKeys: ["1,1"],
      mapDestination: { hexKey: "9,9", name: "Home" },
      mapDestinationReached: true,
      inheritedProgressDestination: {
        sceneId: "scene-2",
        name: "Far",
        hexKey: "0,0",
        direction: "north" as const,
      },
      milesTraveledCumulative: 8,
      currentDifficulty: 5,
      baseDifficulty: 5,
    };

    const imported = buildSceneMapConfig(
      {
        ...defaultHexcrawlState(sceneId),
        enabled: true,
        terrainType: "hard",
        baseDifficulty: 2,
        startingHexKey: "1,1",
        hexAnnotations: { "2,2": { iconId: "camp" } },
        showHexCoords: true,
      },
      { south: "Southern Map" },
    );

    const next = applyMapConfigImport(existing, imported, { south: "scene-3" });

    expect(next.enabled).toBe(true);
    expect(next.terrainType).toBe("hard");
    expect(next.baseDifficulty).toBe(2);
    expect(next.currentDifficulty).toBe(2);
    expect(next.startingHexKey).toBe("1,1");
    expect(next.sceneLinks).toEqual({ south: "scene-3" });
    expect(next.hexAnnotations).toEqual({ "2,2": { iconId: "camp" } });
    expect(next.showHexCoords).toBe(true);

    expect(next.partyActorIds).toEqual(["actor-1"]);
    expect(next.navigatorActorId).toBe("actor-1");
    expect(next.travelTokenId).toBe("tok-1");
    expect(next.hoursTraveledToday).toBe(3);
    expect(next.travelDay).toBe(2);
    expect(next.lastHexKey).toBe("4,4");
    expect(next.journeyLog).toHaveLength(1);
    expect(next.traveledHexKeys).toEqual(["3,3", "4,4"]);
    expect(next.trailCleared).toBe(true);
    expect(next.discoveredPoiHexKeys).toEqual(["1,1"]);
    expect(next.mapDestination).toEqual({ hexKey: "9,9", name: "Home" });
    expect(next.mapDestinationReached).toBe(true);
    expect(next.inheritedProgressDestination).toEqual(existing.inheritedProgressDestination);
    expect(next.milesTraveledCumulative).toBe(8);
  });
});

describe("sceneLinksToNames / sceneLinksFromNames", () => {
  const names: Record<string, string> = {
    "scene-1": "Alpha",
    "scene-2": "Beta",
    "scene-3": "Gamma",
  };
  const idsByName: Record<string, string> = {
    Alpha: "scene-1",
    Beta: "scene-2",
    Gamma: "scene-3",
  };

  it("round-trips scene link ids through scene names", () => {
    const links = { north: "scene-2", east: "scene-3", south: "scene-1" };
    const byName = sceneLinksToNames(links, "scene-1", (id) => names[id]);
    expect(byName).toEqual({ north: "Beta", east: "Gamma" });

    const byId = sceneLinksFromNames(byName, "scene-1", (name) => idsByName[name]);
    expect(byId).toEqual({ north: "scene-2", east: "scene-3" });
  });
});

describe("collectLinkedSceneIds", () => {
  it("walks outbound scene links via BFS", () => {
    const graph: Record<string, Record<string, string>> = {
      root: { north: "b", east: "c" },
      b: { south: "root", north: "d" },
      c: {},
      d: {},
    };

    const ids = collectLinkedSceneIds("root", (id) => graph[id] ?? {});
    expect(ids.sort()).toEqual(["b", "c", "d", "root"].sort());
  });
});

describe("parseHexcrawlConfigBundle", () => {
  it("accepts a valid bundle and rejects unknown versions", () => {
    const bundle = {
      formatVersion: HEXCRAWL_CONFIG_EXPORT_VERSION,
      moduleId: "wastelander",
      exportedAt: 1,
      rootSceneName: "Alpha",
      poiIcons: [{ id: "custom", label: "Custom", path: "icons/custom.png" }],
      scenes: [
        {
          name: "Alpha",
          foundrySceneId: "scene-1",
          config: {
            enabled: true,
            travelEventMode: "hexEntry",
            terrainType: "normal",
            navigationConditionId: "clear-trail",
            baseDifficulty: 1,
            trailOverlayColor: "#863e0e",
            startingHexKey: "0,0",
            sceneLinks: { south: "Beta" },
            hexAnnotations: {},
            hexCoverBaseline: {},
            hiddenTrailHexKeys: [],
            showTerrainIcons: true,
            showHexCoords: false,
          },
        },
        {
          name: "Beta",
          config: {
            enabled: false,
            travelEventMode: "hourChange",
            terrainType: "rough",
            navigationConditionId: "clear-trail",
            baseDifficulty: 2,
            trailOverlayColor: "#112233",
            startingHexKey: null,
            sceneLinks: {},
            hexAnnotations: { "1,1": { iconId: "ruins" } },
            hexCoverBaseline: {},
            hiddenTrailHexKeys: ["2,2"],
            showTerrainIcons: false,
            showHexCoords: true,
          },
        },
      ],
    };

    const parsed = parseHexcrawlConfigBundle(bundle);
    expect(parsed?.scenes).toHaveLength(2);
    expect(parsed?.poiIcons).toHaveLength(1);
    expect(parsed?.scenes[1]?.config.hexAnnotations["1,1"]?.iconId).toBe("ruins");

    expect(parseHexcrawlConfigBundle({ ...bundle, formatVersion: 99 })).toBeNull();
    expect(parseHexcrawlConfigBundle(null)).toBeNull();
  });
});

describe("buildSceneMapConfig baseline restore", () => {
  it("includes live hex covers from baseline when annotations no longer have them", () => {
    const sceneId = "scene-1";
    const state = {
      ...defaultHexcrawlState(sceneId),
      hexAnnotations: { "2,2": { terrain: "normal" } },
      hexCoverBaseline: { "2,2": "#7e876f", "3,3": "#767f67" },
    };

    const config = buildSceneMapConfig(state, {});
    expect(config.hexAnnotations["2,2"]?.hexCoverColor).toBe("#7e876f");
    expect(config.hexAnnotations["3,3"]?.hexCoverColor).toBe("#767f67");
  });
});

describe("applyMapConfigImport with restoreHexCoversFromBaseline", () => {
  it("restores hex covers from imported baseline onto live annotations", () => {
    const sceneId = "scene-1";
    const existing = defaultHexcrawlState(sceneId);
    const imported = {
      ...buildSceneMapConfig(defaultHexcrawlState(sceneId), {}),
      hexAnnotations: { "4,4": { terrain: "rough" } },
      hexCoverBaseline: { "4,4": "#838c75", "5,5": "#838c75" },
    };

    const next = restoreHexCoversFromBaseline(
      applyMapConfigImport(existing, imported, {}),
    );

    expect(next.hexAnnotations["4,4"]?.hexCoverColor).toBe("#838c75");
    expect(next.hexAnnotations["5,5"]?.hexCoverColor).toBe("#838c75");
    expect(next.hexAnnotations["4,4"]?.terrain).toBe("rough");
  });
});

describe("importHexcrawlConfigForScene", () => {
  it("persists hex covers and POI icons to the scene hex map flag", async () => {
    const sceneId = "scene-import";
    const flags: Record<string, Record<string, unknown>> = { [MODULE_ID]: {} };
    const scene = createFoundryFlagScene(flags);
    const sceneDoc = { id: sceneId, name: "Weston Region", ...scene };
    const worldPoiIcons: Array<{ id: string; label: string; path: string }> = [];
    (globalThis as {
      game?: {
        scenes?: {
          get: (id: string) => typeof sceneDoc | undefined;
          find?: (fn: (doc: { id: string; name: string }) => boolean) => { id: string } | undefined;
        };
        world?: { getFlag?: () => null; unsetFlag?: () => Promise<void> };
        user?: { isGM: boolean };
        settings?: {
          get: (scope: string, key: string) => unknown;
          set: (scope: string, key: string, value: unknown) => Promise<void>;
        };
      };
    }).game = {
      scenes: {
        get: (id: string) => (id === sceneId ? sceneDoc : undefined),
        find: (fn) => (fn({ id: sceneId, name: "Weston Region" }) ? { id: sceneId } : undefined),
      },
      world: { getFlag: () => null, unsetFlag: async () => undefined },
      user: { isGM: true },
      settings: {
        get: (_scope, key) => (key === "hexPoiIcons" ? worldPoiIcons : []),
        set: async (_scope, key, value) => {
          if (key === "hexPoiIcons" && Array.isArray(value)) {
            worldPoiIcons.splice(0, worldPoiIcons.length, ...(value as typeof worldPoiIcons));
          }
        },
      },
    };

    const bundle = {
      formatVersion: HEXCRAWL_CONFIG_EXPORT_VERSION,
      moduleId: MODULE_ID,
      exportedAt: 1,
      rootSceneName: "Weston Region",
      poiIcons: [
        {
          id: "settlement-undiscovered",
          label: "Settlement Undiscovered",
          path: "assets/custom/settlement.png",
        },
      ],
      scenes: [
        {
          name: "Weston Region",
          foundrySceneId: "other-id",
          config: {
            enabled: true,
            travelEventMode: "hourChange",
            terrainType: "normal",
            navigationConditionId: "clear-trail",
            baseDifficulty: 1,
            trailOverlayColor: "#863e0e",
            startingHexKey: "14,23",
            sceneLinks: {},
            hexAnnotations: {
              "17,10": { hexCoverColor: "#7e876f" },
              "14,15": { terrain: "normal", iconId: "settlement-undiscovered" },
            },
            hexCoverBaseline: {
              "17,10": "#7e876f",
              "18,10": "#767f67",
            },
            hiddenTrailHexKeys: [],
            showTerrainIcons: true,
            showHexCoords: false,
          },
        },
      ],
    };

    const result = await importHexcrawlConfigForScene(sceneId, bundle);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.hexAnnotations["17,10"]?.hexCoverColor).toBe("#7e876f");
    expect(result.state.hexAnnotations["18,10"]?.hexCoverColor).toBe("#767f67");
    expect(result.state.hexAnnotations["14,15"]?.iconId).toBe("settlement-undiscovered");

    const loaded = loadHexcrawlSceneState(sceneId);
    expect(loaded?.hexAnnotations["17,10"]?.hexCoverColor).toBe("#7e876f");
    expect(loaded?.hexAnnotations["18,10"]?.hexCoverColor).toBe("#767f67");
    expect(loaded?.hexAnnotations["14,15"]?.iconId).toBe("settlement-undiscovered");

    const mapRaw = flags[MODULE_ID][HEXCRAWL_HEX_MAP_FLAG] as {
      hexAnnotations?: Record<string, { hexCoverColor?: string; iconId?: string }>;
    };
    expect(mapRaw.hexAnnotations?.["17,10"]?.hexCoverColor).toBe("#7e876f");
    expect(mapRaw.hexAnnotations?.["14,15"]?.iconId).toBe("settlement-undiscovered");
  });
});
