import { t } from "../integrations/i18n.js";
import { currentUserIsOverseer } from "../integrations/overseerAccess.js";
import { scavengerConfirmDialog } from "../scavenging/scavengerConfirm.js";
import { getHexKeyFromTokenDocument } from "./hexCoords.js";
import HexcrawlTravelApp from "./HexcrawlTravelApp.js";
import { refreshHexcrawlMapOverlay } from "./hexcrawlMapOverlay.js";
import {
  defaultHexcrawlState,
  loadHexcrawlSceneState,
  saveHexcrawlSceneState,
  type HexcrawlSceneState,
} from "./hexcrawlScenePersist.js";
import {
  applySetStartingHex,
  resolveCurrentTravelHexKey,
} from "./hexcrawlTravel.js";
import { debugStartingLocation } from "./startingLocationDebug.js";

type TokenDocForHex = Parameters<typeof getHexKeyFromTokenDocument>[0] & {
  id?: string;
};

function describeSceneTokenSnapshot(sceneId: string): {
  sceneFound: boolean;
  collectionSize: number | null;
  iteratedCount: number;
  tokenIds: string[];
} {
  const scene = game.scenes.get(sceneId) as
    | { tokens?: { size?: number; [Symbol.iterator]?: () => Iterator<{ id?: string }> } }
    | undefined;
  const tokens = scene?.tokens;
  const tokenIds: string[] = [];
  let iteratedCount = 0;
  if (tokens) {
    for (const token of tokens) {
      iteratedCount += 1;
      if (token.id) tokenIds.push(token.id);
    }
  }
  return {
    sceneFound: Boolean(scene),
    collectionSize: typeof tokens?.size === "number" ? tokens.size : null,
    iteratedCount,
    tokenIds,
  };
}

export function explainStartingLocationPromptSkip(
  state: Pick<HexcrawlSceneState, "enabled" | "startingHexKey"> | null,
  sceneTokenCount: number,
): string | null {
  if (!state) return "no hexcrawl scene state";
  if (!state.enabled) return "hexcrawl not enabled on scene";
  if (state.startingHexKey) return `starting hex already set (${state.startingHexKey})`;
  if (sceneTokenCount !== 1) return `scene token count is ${sceneTokenCount}, expected 1`;
  return null;
}

export function shouldOfferStartingLocationPrompt(
  state: Pick<HexcrawlSceneState, "enabled" | "startingHexKey"> | null,
  sceneTokenCount: number,
): boolean {
  if (!state?.enabled) return false;
  if (state.startingHexKey) return false;
  return sceneTokenCount === 1;
}

export function resolveStartingHexKey(
  sceneId: string,
  state: HexcrawlSceneState,
  tokenDoc?: TokenDocForHex | null,
): string | null {
  if (tokenDoc) {
    return getHexKeyFromTokenDocument(tokenDoc);
  }
  return resolveCurrentTravelHexKey(sceneId, state);
}

/** Same outcome as the Set starting location footer button. */
export async function setStartingLocationForScene(
  sceneId: string,
  options?: { tokenDoc?: TokenDocForHex | null; travelTokenId?: string | null },
): Promise<HexcrawlSceneState | null> {
  const state = loadHexcrawlSceneState(sceneId) ?? defaultHexcrawlState(sceneId);
  if (!state.enabled) return null;

  const hexKey = resolveStartingHexKey(sceneId, state, options?.tokenDoc);
  if (!hexKey) {
    ui.notifications.warn(t("WASTELANDER.Hexcrawl.Notify.NoTravelHex"));
    return null;
  }

  let next = applySetStartingHex(state, hexKey);
  if (options?.travelTokenId) {
    next = { ...next, travelTokenId: options.travelTokenId };
  }

  const saved = await saveHexcrawlSceneState(next, { writeHexMap: false });
  const persisted = saved ?? next;
  await refreshHexcrawlMapOverlay(sceneId, persisted);
  HexcrawlTravelApp.rebindForScene(sceneId, { force: true });
  ui.notifications.info(
    t("WASTELANDER.Hexcrawl.Notify.StartingLocationSet", { hex: hexKey }),
  );
  return persisted;
}

export async function promptAndSetStartingLocationFromFirstToken(
  sceneId: string,
  tokenDoc: TokenDocForHex & { id: string },
): Promise<void> {
  debugStartingLocation("createToken: handler entered", {
    sceneId,
    tokenId: tokenDoc.id,
    tokenName: (tokenDoc as { name?: string }).name ?? null,
  });

  if (!currentUserIsOverseer()) {
    debugStartingLocation("skip — current user is not overseer/GM");
    return;
  }

  const state = loadHexcrawlSceneState(sceneId);
  const tokenSnapshot = describeSceneTokenSnapshot(sceneId);
  const sceneTokenCount = tokenSnapshot.collectionSize ?? tokenSnapshot.iteratedCount;
  const skipReason = explainStartingLocationPromptSkip(state, sceneTokenCount);
  debugStartingLocation("eligibility check", {
    sceneId,
    tokenId: tokenDoc.id,
    stateLoaded: Boolean(state),
    enabled: state?.enabled ?? null,
    startingHexKey: state?.startingHexKey ?? null,
    sceneTokenCount,
    ...tokenSnapshot,
    skipReason,
  });
  if (skipReason) {
    debugStartingLocation("skip — prompt not offered", { reason: skipReason });
    return;
  }

  const hexKey = getHexKeyFromTokenDocument(tokenDoc);
  debugStartingLocation("resolved token hex", {
    tokenId: tokenDoc.id,
    hexKey,
    x: (tokenDoc as { x?: number }).x ?? null,
    y: (tokenDoc as { y?: number }).y ?? null,
  });
  if (!hexKey) {
    debugStartingLocation("skip — token is not on a valid hex grid cell");
    return;
  }

  debugStartingLocation("showing confirm dialog", { sceneId, tokenId: tokenDoc.id, hexKey });
  const proceed = await scavengerConfirmDialog(
    t("WASTELANDER.Hexcrawl.StartingLocation.FirstTokenConfirmTitle"),
    t("WASTELANDER.Hexcrawl.StartingLocation.FirstTokenConfirmBody", { hex: hexKey }),
  );
  debugStartingLocation("confirm dialog closed", { proceed });
  if (!proceed) return;

  debugStartingLocation("applying starting location", { sceneId, tokenId: tokenDoc.id, hexKey });
  await setStartingLocationForScene(sceneId, {
    tokenDoc,
    travelTokenId: tokenDoc.id,
  });
  debugStartingLocation("starting location applied", { sceneId, tokenId: tokenDoc.id, hexKey });
}
