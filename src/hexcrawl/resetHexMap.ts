import { t } from "../integrations/i18n.js";
import { currentUserIsOverseer } from "../integrations/overseerAccess.js";
import { scavengerConfirmDialog } from "../scavenging/scavengerConfirm.js";
import { findSceneTokenIdsForActor } from "./hexCoords.js";
import { restoreHexCoversFromBaseline } from "./hexAnnotations.js";
import { refreshHexcrawlMapOverlay } from "./hexcrawlMapOverlay.js";
import { clearMapDestination } from "./hexMapDestination.js";
import {
  appendJourneyLog,
  type HexcrawlSceneState,
  saveHexcrawlSceneState,
} from "./hexcrawlScenePersist.js";

export function applyResetMap(state: HexcrawlSceneState): HexcrawlSceneState {
  const restored = restoreHexCoversFromBaseline(state);
  return appendJourneyLog(
    clearMapDestination({
      ...restored,
      startingHexKey: null,
      lastHexKey: null,
      travelTokenId: null,
      traveledHexKeys: [],
      hiddenTrailHexKeys: [],
      trailCleared: true,
      discoveredPoiHexKeys: [],
      resetTravelPending: null,
      hoursTraveledToday: 0,
      travelDay: 1,
      milesTraveledCumulative: 0,
    }),
    { kind: "mapReset", travelDay: 1 },
  );
}

export async function removePartyTokensFromScene(
  sceneId: string,
  actorIds: string[],
): Promise<number> {
  const tokenIds = new Set<string>();
  for (const actorId of [...new Set(actorIds)]) {
    for (const tokenId of findSceneTokenIdsForActor(sceneId, actorId)) {
      tokenIds.add(tokenId);
    }
  }
  if (!tokenIds.size) return 0;

  const scene = (game as {
    scenes?: {
      get: (id: string) => {
        deleteEmbeddedDocuments?: (type: string, ids: string[]) => Promise<unknown[]>;
      } | undefined;
    };
  }).scenes?.get(sceneId);

  if (!scene?.deleteEmbeddedDocuments) return 0;

  await scene.deleteEmbeddedDocuments("Token", [...tokenIds]);
  return tokenIds.size;
}

export async function confirmAndResetMap(
  sceneId: string,
  state: HexcrawlSceneState,
): Promise<HexcrawlSceneState | null> {
  if (!currentUserIsOverseer()) return null;
  if (!state.enabled) return null;

  const proceed = await scavengerConfirmDialog(
    t("WASTELANDER.Hexcrawl.ResetMap.ConfirmTitle"),
    t("WASTELANDER.Hexcrawl.ResetMap.ConfirmBody"),
  );
  if (!proceed) return null;

  const resetState = applyResetMap(state);
  const saved = await saveHexcrawlSceneState(resetState, { writeHexMap: true });
  const persisted = saved ?? resetState;

  const actorIds = [...state.partyActorIds];
  if (state.navigatorActorId && !actorIds.includes(state.navigatorActorId)) {
    actorIds.push(state.navigatorActorId);
  }
  const removed = await removePartyTokensFromScene(sceneId, actorIds);

  await refreshHexcrawlMapOverlay(sceneId, persisted);

  ui.notifications.info(
    t("WASTELANDER.Hexcrawl.Notify.ResetMapComplete", { count: removed }),
  );
  return persisted;
}
