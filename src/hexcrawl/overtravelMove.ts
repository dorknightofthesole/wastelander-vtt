import { t } from "../integrations/i18n.js";
import { currentUserIsOverseer } from "../integrations/overseerAccess.js";
import { scavengerConfirmDialog } from "../scavenging/scavengerConfirm.js";
import { collectMovementHexKeys } from "./hexCoords.js";
import {
  loadHexcrawlSceneState,
  type HexcrawlSceneState,
} from "./hexcrawlScenePersist.js";
import { processTravelHexEntry } from "./hexcrawlTravel.js";
import { requestPlayerHexcrawlAction } from "./playerHexcrawlActions.js";
import { getSceneMilesPerHex } from "./sceneGrid.js";
import { filterHexcrawlTravelRoleActorIds } from "./partyTravel.js";
import {
  computeTravelFatigueDelta,
  hexTravelMinutes,
  resolvePartyTravelMph,
} from "./travelRules.js";

export type TokenMovementPayload = {
  origin?: { x?: number; y?: number; width?: number; height?: number };
  passed?: unknown;
  destination?: { x?: number; y?: number; width?: number; height?: number };
};

type TokenDocForMove = {
  id: string;
  parent?: { id: string } | null;
  update?: (data: Record<string, unknown>) => Promise<unknown>;
};

const approvedOvertravelKeys = new Set<string>();
const overtravelPromptInFlight = new Set<string>();

function approvalKey(sceneId: string, tokenId: string, hexKey: string): string {
  return `${sceneId}:${tokenId}:${hexKey}`;
}

function promptKey(sceneId: string, tokenId: string): string {
  return `${sceneId}:${tokenId}`;
}

export function needsOvertravelPrompt(state: HexcrawlSceneState): boolean {
  return state.hoursTraveledToday >= state.maxHoursPerDay;
}

function projectedHoursAfterHex(state: HexcrawlSceneState, sceneId: string): number {
  const mph = resolvePartyTravelMph(
    filterHexcrawlTravelRoleActorIds(state.partyActorIds),
  );
  const minutes = hexTravelMinutes(getSceneMilesPerHex(sceneId), mph);
  return state.hoursTraveledToday + minutes / 60;
}

export function projectedOvertravelFatigue(
  state: HexcrawlSceneState,
  sceneId: string,
): number {
  const hoursAfter = projectedHoursAfterHex(state, sceneId);
  return computeTravelFatigueDelta(
    state.hoursTraveledToday,
    hoursAfter,
    state.maxHoursPerDay,
  );
}

export function markOvertravelApproved(
  sceneId: string,
  tokenId: string,
  hexKey: string,
): void {
  approvedOvertravelKeys.add(approvalKey(sceneId, tokenId, hexKey));
}

export function consumeOvertravelApproval(
  sceneId: string,
  tokenId: string,
  hexKey: string,
): boolean {
  const key = approvalKey(sceneId, tokenId, hexKey);
  if (!approvedOvertravelKeys.has(key)) return false;
  approvedOvertravelKeys.delete(key);
  return true;
}

export function isOvertravelMovePending(sceneId: string, tokenId: string): boolean {
  return overtravelPromptInFlight.has(promptKey(sceneId, tokenId));
}

export async function executeApprovedOvertravelMove(params: {
  sceneId: string;
  tokenId: string;
  hexKey: string;
  destination: { x: number; y: number };
}): Promise<HexcrawlSceneState | null> {
  const state = loadHexcrawlSceneState(params.sceneId);
  if (!state?.enabled || state.arrived) return null;
  if (state.travelTokenId !== params.tokenId) return null;
  if (!needsOvertravelPrompt(state)) return null;
  if (state.lastHexKey === params.hexKey) return state;

  const scene = game.scenes.get(params.sceneId);
  const tokenDoc = scene?.tokens?.get(params.tokenId) as TokenDocForMove | undefined;
  if (!tokenDoc?.update) return null;

  markOvertravelApproved(params.sceneId, params.tokenId, params.hexKey);
  await tokenDoc.update({
    x: params.destination.x,
    y: params.destination.y,
  });

  await processTravelHexEntry({
    sceneId: params.sceneId,
    tokenId: params.tokenId,
    hexKey: params.hexKey,
  });

  return loadHexcrawlSceneState(params.sceneId);
}

export async function promptAndExecuteOvertravelMove(
  doc: TokenDocForMove,
  movement: TokenMovementPayload,
): Promise<void> {
  const sceneId = doc.parent?.id;
  if (!sceneId) return;

  const inFlightKey = promptKey(sceneId, doc.id);
  if (overtravelPromptInFlight.has(inFlightKey)) return;

  const state = loadHexcrawlSceneState(sceneId);
  if (!state?.enabled || state.arrived || !needsOvertravelPrompt(state)) return;

  const hexKeys = collectMovementHexKeys(doc, movement);
  if (!hexKeys.length) return;
  const destHex = hexKeys[hexKeys.length - 1];
  if (state.lastHexKey === destHex) return;

  const destination = movement.destination;
  if (
    !destination ||
    !Number.isFinite(destination.x) ||
    !Number.isFinite(destination.y)
  ) {
    return;
  }

  const fatigueHours = projectedOvertravelFatigue(state, sceneId);

  overtravelPromptInFlight.add(inFlightKey);
  try {
    const proceed = await scavengerConfirmDialog(
      t("WASTELANDER.Hexcrawl.Overtravel.ConfirmTitle"),
      fatigueHours > 0
        ? t("WASTELANDER.Hexcrawl.Overtravel.ConfirmBodyFatigue", {
            fatigue: fatigueHours,
            hours: fatigueHours,
          })
        : t("WASTELANDER.Hexcrawl.Overtravel.ConfirmBody"),
    );
    if (!proceed) return;

    if (currentUserIsOverseer()) {
      await executeApprovedOvertravelMove({
        sceneId,
        tokenId: doc.id,
        hexKey: destHex,
        destination: { x: destination.x!, y: destination.y! },
      });
      return;
    }

    const result = await requestPlayerHexcrawlAction({
      action: "overtravelMove",
      sceneId,
      tokenId: doc.id,
      hexKey: destHex,
      destination: { x: destination.x!, y: destination.y! },
    });
    if (!result.ok) {
      ui.notifications.warn(
        t("WASTELANDER.Hexcrawl.Overtravel.Failed", { error: result.error }),
      );
    }
  } finally {
    overtravelPromptInFlight.delete(inFlightKey);
  }
}
