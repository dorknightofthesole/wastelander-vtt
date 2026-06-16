import { afterEach, describe, expect, it } from "vitest";
import {
  countCoverHexKeys,
  createFoundryFlagScene,
  createMergeOnlyFoundryFlagScene,
  installHexcrawlFlagGame,
  MODULE_ID,
} from "./foundryFlagTestMock.js";
import {
  defaultHexcrawlState,
  HEXCRAWL_HEX_MAP_FLAG,
  HEXCRAWL_SCENE_STATE_FLAG,
  loadHexcrawlSceneState,
  removeHexCoversOnEntry,
  saveHexcrawlSceneState,
} from "./hexcrawlScenePersist.js";

function buildCoverAnnotations(count: number): Record<string, { hexCoverColor: string }> {
  const annotations: Record<string, { hexCoverColor: string }> = {};
  for (let i = 0; i < count; i += 1) {
    const col = 8 + (i % 6);
    const row = 11 + Math.floor(i / 6);
    annotations[`${col},${row}`] = { hexCoverColor: "#808080" };
  }
  return annotations;
}

describe("hex cover persistence regression", () => {
  const sceneId = "scene-cover-regression";
  const flags: Record<string, Record<string, unknown>> = { [MODULE_ID]: {} };

  afterEach(() => {
    for (const key of Object.keys(flags[MODULE_ID] ?? {})) {
      delete flags[MODULE_ID][key];
    }
  });

  it("batch-removes covers from a large map so load matches the hex map flag", async () => {
    const scene = createFoundryFlagScene(flags);
    installHexcrawlFlagGame(sceneId, scene);

    const hexAnnotations = buildCoverAnnotations(22);
    await saveHexcrawlSceneState({
      ...defaultHexcrawlState(sceneId),
      enabled: true,
      hexAnnotations,
    });

    expect(countCoverHexKeys(loadHexcrawlSceneState(sceneId)?.hexAnnotations)).toBe(22);

    const removed = await removeHexCoversOnEntry(sceneId, ["8,11", "9,11"]);
    expect(removed).toBe(true);

    const loaded = loadHexcrawlSceneState(sceneId);
    const mapRaw = flags[MODULE_ID][HEXCRAWL_HEX_MAP_FLAG] as {
      hexAnnotations?: Record<string, { hexCoverColor?: string }>;
    };

    expect(loaded?.hexAnnotations["8,11"]).toBeUndefined();
    expect(loaded?.hexAnnotations["9,11"]).toBeUndefined();
    expect(countCoverHexKeys(loaded?.hexAnnotations)).toBe(20);
    expect(countCoverHexKeys(mapRaw.hexAnnotations)).toBe(20);
    expect(mapRaw.hexAnnotations?.["8,11"]).toBeUndefined();
    expect(mapRaw.hexAnnotations?.["9,11"]).toBeUndefined();
  });

  it("does not resurrect cleared covers when travel progress saves with stale in-memory state", async () => {
    const scene = createFoundryFlagScene(flags);
    installHexcrawlFlagGame(sceneId, scene);

    const withCover = {
      ...defaultHexcrawlState(sceneId),
      enabled: true,
      travelTokenId: "tok-1",
      hexAnnotations: buildCoverAnnotations(22),
    };
    await saveHexcrawlSceneState(withCover);
    await removeHexCoversOnEntry(sceneId, ["8,11", "9,11"]);

    await saveHexcrawlSceneState(
      {
        ...withCover,
        lastHexKey: "9,11",
        traveledHexKeys: ["8,11", "9,11"],
      },
      { writeHexMap: false },
    );

    expect(countCoverHexKeys(loadHexcrawlSceneState(sceneId)?.hexAnnotations)).toBe(20);
    expect(
      countCoverHexKeys(
        (
          flags[MODULE_ID][HEXCRAWL_HEX_MAP_FLAG] as {
            hexAnnotations?: Record<string, { hexCoverColor?: string }>;
          }
        ).hexAnnotations,
      ),
    ).toBe(20);
  });

  it("requires unsetFlag — merge-only writes keep deleted cover keys", async () => {
    const scene = createMergeOnlyFoundryFlagScene(flags);
    installHexcrawlFlagGame(sceneId, scene);

    flags[MODULE_ID][HEXCRAWL_SCENE_STATE_FLAG] = {
      ...defaultHexcrawlState(sceneId),
      enabled: true,
      version: 1,
    };
    flags[MODULE_ID][HEXCRAWL_HEX_MAP_FLAG] = {
      hexAnnotations: buildCoverAnnotations(22),
      hiddenTrailHexKeys: [],
      showTerrainIcons: true,
      updatedAt: 1,
    };

    const removed = await removeHexCoversOnEntry(sceneId, ["8,11", "9,11"]);
    expect(removed).toBe(true);

    const mapRaw = flags[MODULE_ID][HEXCRAWL_HEX_MAP_FLAG] as {
      hexAnnotations?: Record<string, { hexCoverColor?: string }>;
    };

    // Documents the Foundry flag-merge bug: without unsetFlag, omitted keys survive.
    expect(mapRaw.hexAnnotations?.["8,11"]?.hexCoverColor).toBe("#808080");
    expect(mapRaw.hexAnnotations?.["9,11"]?.hexCoverColor).toBe("#808080");
    expect(countCoverHexKeys(mapRaw.hexAnnotations)).toBe(22);
  });
});
