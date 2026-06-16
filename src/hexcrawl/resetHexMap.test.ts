import { afterEach, describe, expect, it } from "vitest";
import {
  createFoundryFlagScene,
  installHexcrawlFlagGame,
  MODULE_ID,
} from "./foundryFlagTestMock.js";
import {
  applyResetMap,
  removePartyTokensFromScene,
} from "./resetHexMap.js";
import {
  defaultHexcrawlState,
  HEXCRAWL_HEX_MAP_FLAG,
  loadHexcrawlSceneState,
  resolveTrailHexKeys,
  saveHexcrawlSceneState,
} from "./hexcrawlScenePersist.js";
import { setHexCoverForEditor, toggleHexCoverForEditor } from "./hexAnnotations.js";
import { removeHexCoversOnEntry } from "./hexcrawlScenePersist.js";

describe("reset map", () => {
  const sceneId = "scene-reset-map";
  const flags: Record<string, Record<string, unknown>> = { [MODULE_ID]: {} };

  afterEach(() => {
    for (const key of Object.keys(flags[MODULE_ID] ?? {})) {
      delete flags[MODULE_ID][key];
    }
  });

  it("stores cover baseline on editor placement and restores after travel clears covers", async () => {
    installHexcrawlFlagGame(sceneId, createFoundryFlagScene(flags));

    let state = toggleHexCoverForEditor(
      {
        ...defaultHexcrawlState(sceneId),
        enabled: true,
      },
      "8,11",
    );
    await saveHexcrawlSceneState(state);

    expect(loadHexcrawlSceneState(sceneId)?.hexCoverBaseline["8,11"]).toBe("#808080");

    await removeHexCoversOnEntry(sceneId, ["8,11"]);
    expect(loadHexcrawlSceneState(sceneId)?.hexAnnotations["8,11"]).toBeUndefined();
    expect(loadHexcrawlSceneState(sceneId)?.hexCoverBaseline["8,11"]).toBe("#808080");

    const reset = applyResetMap(loadHexcrawlSceneState(sceneId)!);
    expect(reset.hexAnnotations["8,11"]?.hexCoverColor).toBe("#808080");
    expect(reset.startingHexKey).toBeNull();
    expect(reset.lastHexKey).toBeNull();
    expect(reset.travelTokenId).toBeNull();
    expect(reset.traveledHexKeys).toEqual([]);
    expect(reset.trailCleared).toBe(true);
    expect(reset.discoveredPoiHexKeys).toEqual([]);
  });

  it("persists reset map trail clear and cover restore", async () => {
    installHexcrawlFlagGame(sceneId, createFoundryFlagScene(flags));

    let state = toggleHexCoverForEditor(
      {
        ...defaultHexcrawlState(sceneId),
        enabled: true,
        startingHexKey: "0,0",
        lastHexKey: "2,2",
        travelTokenId: "tok-travel",
        traveledHexKeys: ["0,0", "1,1", "2,2"],
        discoveredPoiHexKeys: ["3,3"],
        hexAnnotations: { "3,3": { iconId: "camp" as const } },
      },
      "8,11",
    );
    await saveHexcrawlSceneState(state);
    await removeHexCoversOnEntry(sceneId, ["8,11"]);

    const reset = applyResetMap(loadHexcrawlSceneState(sceneId)!);
    await saveHexcrawlSceneState(reset, { writeHexMap: true });

    const loaded = loadHexcrawlSceneState(sceneId)!;
    expect(loaded.hexAnnotations["8,11"]?.hexCoverColor).toBe("#808080");
    expect(loaded.startingHexKey).toBeNull();
    expect(loaded.lastHexKey).toBeNull();
    expect(loaded.travelTokenId).toBeNull();
    expect(resolveTrailHexKeys(loaded)).toEqual([]);
    expect(loaded.discoveredPoiHexKeys).toEqual([]);
    expect(loaded.journeyLog[0]?.kind).toBe("mapReset");

    const mapRaw = flags[MODULE_ID][HEXCRAWL_HEX_MAP_FLAG] as {
      hexCoverBaseline?: Record<string, string>;
    };
    expect(mapRaw.hexCoverBaseline?.["8,11"]).toBe("#808080");
  });

  it("removePartyTokensFromScene deletes tokens for listed actors", async () => {
    const deleted: string[][] = [];
    const scene = {
      tokens: [
        { id: "tok-a", actorId: "actor-a" },
        { id: "tok-b", actorId: "actor-b" },
      ],
      deleteEmbeddedDocuments: async (_type: string, ids: string[]) => {
        deleted.push(ids);
        return ids;
      },
    };
    (globalThis as { game?: unknown }).game = {
      scenes: { get: (id: string) => (id === sceneId ? scene : undefined) },
    };

    const count = await removePartyTokensFromScene(sceneId, ["actor-a", "actor-c"]);
    expect(count).toBe(1);
    expect(deleted).toEqual([["tok-a"]]);
  });
});
