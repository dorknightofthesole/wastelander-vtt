import { describe, expect, it, afterEach } from "vitest";
import { MODULE_ID } from "../constants.js";
import {
  defaultHexcrawlState,
  HEXCRAWL_HEX_MAP_FLAG,
  HEXCRAWL_SCENE_STATE_FLAG,
  loadHexcrawlSceneState,
  removeHexCoverOnEntry,
  saveHexcrawlSceneState,
} from "./hexcrawlScenePersist.js";
import { tokenQualifiesForHexEntry } from "./hexcrawlTravel.js";

/** Foundry merges nested flag objects; deleted keys survive unless the flag is unset first. */
function mergeLikeFoundryFlags(existing: unknown, incoming: unknown): unknown {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return structuredClone(incoming);
  }
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    return structuredClone(incoming);
  }
  const out = { ...(existing as Record<string, unknown>) };
  for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
    out[key] = mergeLikeFoundryFlags(out[key], value);
  }
  return out;
}

function createFoundryFlagScene(
  sceneId: string,
  flags: Record<string, Record<string, unknown>>,
) {
  return {
    unsetFlag: async (scope: string, key: string) => {
      if (flags[scope]) delete flags[scope][key];
    },
    setFlag: async (scope: string, key: string, value: unknown) => {
      if (!flags[scope]) flags[scope] = {};
      flags[scope][key] = mergeLikeFoundryFlags(flags[scope][key], value);
    },
    getFlag: (scope: string, key: string) => flags[scope]?.[key],
    update: async (data: Record<string, unknown>) => {
      for (const [path, val] of Object.entries(data)) {
        const match = path.match(
          /^flags\.([^.\[]+)\.([^.\[]+)\.-([^.\[]+)$/,
        );
        if (!match || val !== null) continue;
        const [, scope, flagKey, field] = match;
        const row = flags[scope]?.[flagKey] as Record<string, unknown> | undefined;
        if (row) delete row[field];
      }
    },
  };
}

describe("removeHexCoverOnEntry", () => {
  const sceneId = "scene-travel-cover";
  const flags: Record<string, Record<string, unknown>> = { [MODULE_ID]: {} };

  afterEach(() => {
    for (const key of Object.keys(flags[MODULE_ID] ?? {})) {
      delete flags[MODULE_ID][key];
    }
  });

  function installGame(): void {
    const scene = createFoundryFlagScene(sceneId, flags);

    (globalThis as { game?: unknown }).game = {
      scenes: {
        get: (id: string) => (id === sceneId ? scene : undefined),
      },
      world: { getFlag: () => null, unsetFlag: async () => undefined },
    };
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
    const scene = createFoundryFlagScene(sceneId, flags);

    (globalThis as { game?: unknown }).game = {
      scenes: {
        get: (id: string) => (id === sceneId ? scene : undefined),
      },
      world: { getFlag: () => null, unsetFlag: async () => undefined },
      user: { isGM: true },
    };

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
    const scene = createFoundryFlagScene(sceneId, flags);

    (globalThis as { game?: unknown }).game = {
      scenes: {
        get: (id: string) => (id === sceneId ? scene : undefined),
      },
      world: { getFlag: () => null, unsetFlag: async () => undefined },
      user: { isGM: true },
    };

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
