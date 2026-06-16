import { afterEach, describe, expect, it } from "vitest";
import {
  createFoundryFlagScene,
  installHexcrawlFlagGame,
  MODULE_ID,
} from "./foundryFlagTestMock.js";
import {
  defaultHexcrawlState,
  HEXCRAWL_SCENE_STATE_FLAG,
  loadHexcrawlSceneState,
  resolveTrailHexKeys,
  saveHexcrawlSceneState,
} from "./hexcrawlScenePersist.js";
import { applyResetTravel } from "./hexcrawlTravel.js";

describe("reset travel persistence regression", () => {
  const sceneId = "scene-reset-trail";
  const flags: Record<string, Record<string, unknown>> = { [MODULE_ID]: {} };

  afterEach(() => {
    for (const key of Object.keys(flags[MODULE_ID] ?? {})) {
      delete flags[MODULE_ID][key];
    }
  });

  it("persists shortened trail after reset when on-disk trail is longer", async () => {
    installHexcrawlFlagGame(sceneId, createFoundryFlagScene(flags));

    const traveledHexKeys = ["0,0", "1,1", "2,2", "3,3", "4,4"];
    await saveHexcrawlSceneState({
      ...defaultHexcrawlState(sceneId),
      enabled: true,
      startingHexKey: "0,0",
      traveledHexKeys,
      travelDay: 3,
      hoursTraveledToday: 2,
      journeyLog: [
        { at: 1, kind: "hexEntered", travelDay: 1, hexKey: "1,1" },
        { at: 2, kind: "hexEntered", travelDay: 2, hexKey: "3,3" },
      ],
    });

    const beforeReset = loadHexcrawlSceneState(sceneId);
    expect(beforeReset?.traveledHexKeys).toEqual(traveledHexKeys);
    expect(resolveTrailHexKeys(beforeReset!)).toEqual(traveledHexKeys);

    const resetState = applyResetTravel(beforeReset!, "tok-nav");
    await saveHexcrawlSceneState(resetState, { writeHexMap: false });

    const loaded = loadHexcrawlSceneState(sceneId);
    expect(loaded?.traveledHexKeys).toEqual(["0,0"]);
    expect(resolveTrailHexKeys(loaded!)).toEqual(["0,0"]);
    expect(loaded?.journeyLog[0]?.kind).toBe("travelReset");
    expect(loaded?.travelDay).toBe(1);
    expect(loaded?.hoursTraveledToday).toBe(0);

    const mainRaw = flags[MODULE_ID][HEXCRAWL_SCENE_STATE_FLAG] as {
      traveledHexKeys?: string[];
    };
    expect(mainRaw.traveledHexKeys).toEqual(["0,0"]);
  });
});
