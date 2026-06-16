import { describe, expect, it, afterEach } from "vitest";
import {
  createFoundryFlagScene,
  installHexcrawlFlagGame,
  MODULE_ID,
} from "./foundryFlagTestMock.js";
import {
  defaultHexcrawlState,
  HEXCRAWL_HEX_MAP_FLAG,
  HEXCRAWL_SCENE_STATE_FLAG,
  loadHexcrawlSceneState,
  removeHexCoverOnEntry,
  saveHexcrawlSceneState,
} from "./hexcrawlScenePersist.js";
import { tokenQualifiesForHexEntry } from "./hexcrawlTravel.js";

describe("removeHexCoverOnEntry", () => {
  const sceneId = "scene-travel-cover";
  const flags: Record<string, Record<string, unknown>> = { [MODULE_ID]: {} };

  afterEach(() => {
    for (const key of Object.keys(flags[MODULE_ID] ?? {})) {
      delete flags[MODULE_ID][key];
    }
  });

  function installGame(): void {
    installHexcrawlFlagGame(sceneId, createFoundryFlagScene(flags));
  }

  it("deletes hex cover from the hex map flag", async () => {
    installGame();

    const withCover = {
      ...defaultHexcrawlState(sceneId),
      enabled: true,
      hexAnnotations: { "4,4": { hexCoverColor: "#808080" } },
    };
    await saveHexcrawlSceneState(withCover);

    const cleared = await removeHexCoverOnEntry(sceneId, "4,4");
    expect(cleared).toBe(true);

    const loaded = loadHexcrawlSceneState(sceneId);
    expect(loaded?.hexAnnotations["4,4"]).toBeUndefined();
    expect(
      (flags[MODULE_ID][HEXCRAWL_HEX_MAP_FLAG] as { hexAnnotations?: Record<string, unknown> })
        .hexAnnotations,
    ).toEqual({});
  });

  it("does nothing when the hex has no cover", async () => {
    installGame();

    const state = {
      ...defaultHexcrawlState(sceneId),
      enabled: true,
      hexAnnotations: { "2,2": { iconId: "camp" as const } },
    };
    await saveHexcrawlSceneState(state);

    const cleared = await removeHexCoverOnEntry(sceneId, "2,2");
    expect(cleared).toBe(false);
    expect(loadHexcrawlSceneState(sceneId)?.hexAnnotations["2,2"]).toEqual({ iconId: "camp" });
  });

  it("drops removed cover keys under Foundry nested flag merge", async () => {
    installGame();

    flags[MODULE_ID][HEXCRAWL_SCENE_STATE_FLAG] = {
      ...defaultHexcrawlState(sceneId),
      enabled: true,
      version: 1,
    };
    flags[MODULE_ID][HEXCRAWL_HEX_MAP_FLAG] = {
      hexAnnotations: {
        "1,1": { hexCoverColor: "#808080" },
        "2,2": { hexCoverColor: "#808080" },
        "3,3": { hexCoverColor: "#808080" },
      },
      hiddenTrailHexKeys: [],
      showTerrainIcons: true,
      updatedAt: 1,
    };

    const cleared = await removeHexCoverOnEntry(sceneId, "2,2");
    expect(cleared).toBe(true);

    const mapRaw = flags[MODULE_ID][HEXCRAWL_HEX_MAP_FLAG] as {
      hexAnnotations?: Record<string, { hexCoverColor?: string }>;
    };
    expect(mapRaw.hexAnnotations?.["2,2"]).toBeUndefined();
    expect(
      Object.values(mapRaw.hexAnnotations ?? {}).filter((row) => row.hexCoverColor),
    ).toHaveLength(2);
  });
});

describe("travel progress save", () => {
  const sceneId = "scene-travel-resurrect";
  const flags: Record<string, Record<string, unknown>> = { [MODULE_ID]: {} };

  afterEach(() => {
    for (const key of Object.keys(flags[MODULE_ID] ?? {})) {
      delete flags[MODULE_ID][key];
    }
  });

  it("does not resurrect a cleared hex cover when saving travel progress", async () => {
    installHexcrawlFlagGame(sceneId, createFoundryFlagScene(flags));

    const withCover = {
      ...defaultHexcrawlState(sceneId),
      enabled: true,
      travelTokenId: "tok-1",
      hexAnnotations: { "5,5": { hexCoverColor: "#808080" } },
    };
    await saveHexcrawlSceneState(withCover);
    await removeHexCoverOnEntry(sceneId, "5,5");

    const staleTravelState = {
      ...withCover,
      lastHexKey: "5,5",
      traveledHexKeys: ["5,5"],
    };
    await saveHexcrawlSceneState(staleTravelState, { writeHexMap: false });

    const loaded = loadHexcrawlSceneState(sceneId);
    expect(loaded?.hexAnnotations["5,5"]).toBeUndefined();
    expect(
      (flags[MODULE_ID][HEXCRAWL_HEX_MAP_FLAG] as { hexAnnotations?: Record<string, unknown> })
        .hexAnnotations,
    ).toEqual({});
  });

  it("load ignores stale covers embedded in the main flag when hex map exists", async () => {
    installHexcrawlFlagGame(sceneId, createFoundryFlagScene(flags));

    const withCover = {
      ...defaultHexcrawlState(sceneId),
      enabled: true,
      hexAnnotations: { "8,11": { hexCoverColor: "#808080" } },
    };
    await saveHexcrawlSceneState(withCover);
    await removeHexCoverOnEntry(sceneId, "8,11");

    // Simulate legacy/stale data: main flag still has the cover, hex map does not.
    const main = flags[MODULE_ID][HEXCRAWL_SCENE_STATE_FLAG] as Record<string, unknown>;
    main.hexAnnotations = { "8,11": { hexCoverColor: "#808080" } };

    const loaded = loadHexcrawlSceneState(sceneId);
    expect(loaded?.hexAnnotations["8,11"]).toBeUndefined();
  });
});

describe("tokenQualifiesForHexEntry", () => {
  const sceneId = "scene-token-qualify";
  const tokens = new Map<string, { id: string; actorId?: string }>([
    ["travel-tok", { id: "travel-tok", actorId: "actor-nav" }],
    ["other-tok", { id: "other-tok", actorId: "actor-other" }],
  ]);

  it("qualifies the navigator token even when travelTokenId points elsewhere", () => {
    const scene = {
      tokens: Object.assign([...tokens.values()], {
        get: (id: string) => tokens.get(id),
      }),
    };
    (globalThis as { game?: unknown }).game = {
      scenes: { get: (id: string) => (id === sceneId ? scene : undefined) },
    };

    const state = {
      ...defaultHexcrawlState(sceneId),
      travelTokenId: "missing-tok",
      navigatorActorId: "actor-nav",
    };
    expect(tokenQualifiesForHexEntry(sceneId, state, "travel-tok")).toBe(true);
    expect(tokenQualifiesForHexEntry(sceneId, state, "other-tok")).toBe(false);
  });
});
