import { MODULE_ID } from "../constants.js";
import { t } from "../integrations/i18n.js";
import { currentUserIsOverseer, isOverseer } from "../integrations/overseerAccess.js";
import { userControlsActor } from "../scavenging/partyContext.js";
import HexcrawlTravelApp from "./HexcrawlTravelApp.js";
import {
  loadHexcrawlSceneState,
  saveHexcrawlSceneState,
  type HexcrawlSceneState,
} from "./hexcrawlScenePersist.js";
import { executeApprovedOvertravelMove } from "./overtravelMove.js";
import { canAddActorToParty, syncPartyTravelState } from "./partyTravel.js";

export type UpdateHexcrawlPartyAction = {
  action: "updateHexcrawlParty";
  sceneId: string;
  partyActorIds: string[];
};

export type OvertravelMoveAction = {
  action: "overtravelMove";
  sceneId: string;
  tokenId: string;
  hexKey: string;
  destination: { x: number; y: number };
};

export type PlayerHexcrawlSocketAction =
  | UpdateHexcrawlPartyAction
  | OvertravelMoveAction;

export type PlayerHexcrawlActionResult =
  | { ok: true; state: HexcrawlSceneState }
  | { ok: false; error: string };

type SocketPayload = PlayerHexcrawlSocketAction & {
  _requestId?: string;
  userId?: string;
  ok?: boolean;
};

function validatePartyUpdate(
  userId: string,
  sceneId: string,
  partyActorIds: string[],
  state: HexcrawlSceneState,
): string | null {
  if (!state.enabled) {
    return t("WASTELANDER.Hexcrawl.PlayerParty.NotEnabled");
  }

  for (const actorId of partyActorIds) {
    if (!canAddActorToParty(actorId, sceneId, userId)) {
      return t("WASTELANDER.Hexcrawl.PlayerParty.InvalidMember");
    }
  }

  const current = new Set(state.partyActorIds);
  const next = new Set(partyActorIds);
  const touched = new Set([...current, ...next]);
  const requester = game.users.get(userId) as { isGM?: boolean; role?: number } | undefined;
  const requesterIsOverseer = isOverseer(requester);
  for (const actorId of touched) {
    if (current.has(actorId) === next.has(actorId)) continue;
    if (!requesterIsOverseer && !userControlsActor(actorId, userId, sceneId)) {
      return t("WASTELANDER.Hexcrawl.PlayerParty.CannotChangeMember");
    }
  }

  return null;
}

function validateOvertravelMove(
  data: OvertravelMoveAction,
  state: HexcrawlSceneState,
): string | null {
  if (!state.enabled) {
    return t("WASTELANDER.Hexcrawl.PlayerParty.NotEnabled");
  }
  if (state.arrived) {
    return t("WASTELANDER.Hexcrawl.Overtravel.Arrived");
  }
  if (state.travelTokenId !== data.tokenId) {
    return t("WASTELANDER.Hexcrawl.Overtravel.NotTravelToken");
  }
  if (state.hoursTraveledToday < state.maxHoursPerDay) {
    return t("WASTELANDER.Hexcrawl.Overtravel.BelowMaxHours");
  }
  if (state.lastHexKey === data.hexKey) {
    return t("WASTELANDER.Hexcrawl.Overtravel.SameHex");
  }
  return null;
}

export async function executePlayerHexcrawlAction(
  data: PlayerHexcrawlSocketAction,
  userId: string,
): Promise<PlayerHexcrawlActionResult> {
  if (data.action === "updateHexcrawlParty") {
    const state = loadHexcrawlSceneState(data.sceneId);
    if (!state) {
      return { ok: false, error: t("WASTELANDER.Hexcrawl.PlayerParty.NoState") };
    }

    const validationError = validatePartyUpdate(
      userId,
      data.sceneId,
      data.partyActorIds,
      state,
    );
    if (validationError) {
      return { ok: false, error: validationError };
    }

    const next = syncPartyTravelState(
      {
        ...state,
        partyActorIds: [...data.partyActorIds],
      },
      data.sceneId,
    );

    await saveHexcrawlSceneState(next);
    HexcrawlTravelApp.rebindForScene(data.sceneId);
    return { ok: true, state: next };
  }

  if (data.action === "overtravelMove") {
    const state = loadHexcrawlSceneState(data.sceneId);
    if (!state) {
      return { ok: false, error: t("WASTELANDER.Hexcrawl.PlayerParty.NoState") };
    }

    const validationError = validateOvertravelMove(data, state);
    if (validationError) {
      return { ok: false, error: validationError };
    }

    const next = await executeApprovedOvertravelMove({
      sceneId: data.sceneId,
      tokenId: data.tokenId,
      hexKey: data.hexKey,
      destination: data.destination,
    });
    if (!next) {
      return { ok: false, error: t("WASTELANDER.Hexcrawl.Overtravel.MoveFailed") };
    }

    HexcrawlTravelApp.rebindForScene(data.sceneId);
    return { ok: true, state: next };
  }

  return { ok: false, error: "Unknown action" };
}

export function isPlayerHexcrawlSocketRequest(data: SocketPayload): boolean {
  if (typeof data.ok === "boolean") return false;
  return data.action === "updateHexcrawlParty" || data.action === "overtravelMove";
}

export function isPlayerHexcrawlSocketResponse(
  data: SocketPayload,
): data is SocketPayload & { ok: boolean; _requestId: string; state?: HexcrawlSceneState } {
  return typeof data._requestId === "string" && typeof data.ok === "boolean";
}

export async function requestPlayerHexcrawlAction(
  data: PlayerHexcrawlSocketAction,
): Promise<PlayerHexcrawlActionResult> {
  if (currentUserIsOverseer()) {
    return executePlayerHexcrawlAction(data, game.user?.id ?? "");
  }

  const socket = (game as { socket?: { emit: (channel: string, data: unknown) => void } })
    .socket;
  if (!socket?.emit) {
    return {
      ok: false,
      error: t("WASTELANDER.Hexcrawl.PlayerParty.SocketUnavailable"),
    };
  }

  const requestId = `hex-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const channel = `module.${MODULE_ID}`;
  const payload = { ...data, _requestId: requestId, userId: game.user?.id };

  const sock = game as {
    socket?: {
      emit: (channel: string, data: unknown) => void;
      on: (channel: string, fn: (data: unknown) => void) => void;
      off: (channel: string, fn: (data: unknown) => void) => void;
    };
  };

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      sock.socket?.off(channel, handler);
      resolve({ ok: false, error: t("WASTELANDER.Hexcrawl.PlayerParty.GmOffline") });
    }, 15000);

    const handler = (response: unknown): void => {
      const msg = response as SocketPayload & {
        _targetUserId?: string;
        state?: HexcrawlSceneState;
        error?: string;
      };
      if (!isPlayerHexcrawlSocketResponse(msg)) return;
      if (msg._requestId !== requestId) return;
      if (msg._targetUserId && msg._targetUserId !== game.user?.id) return;
      window.clearTimeout(timeout);
      sock.socket?.off(channel, handler);
      if (msg.ok && msg.state) {
        resolve({ ok: true, state: msg.state });
      } else {
        resolve({
          ok: false,
          error: msg.error ?? t("WASTELANDER.Hexcrawl.PlayerParty.UpdateFailed"),
        });
      }
    };

    sock.socket?.on(channel, handler);
    socket.emit(channel, payload);
  });
}

export async function handlePlayerHexcrawlSocket(data: SocketPayload): Promise<void> {
  if (!currentUserIsOverseer()) return;
  if (!isPlayerHexcrawlSocketRequest(data)) return;

  const userId = data.userId ?? game.user.id;
  const { _requestId, userId: _uid, ok: _ok, ...actionData } = data;
  const result = await executePlayerHexcrawlAction(
    actionData as PlayerHexcrawlSocketAction,
    userId,
  );

  const channel = `module.${MODULE_ID}`;
  const socket = (game as { socket?: { emit: (channel: string, data: unknown) => void } })
    .socket;
  if (!socket?.emit || !_requestId) return;

  socket.emit(channel, {
    _requestId,
    _targetUserId: userId,
    ok: result.ok,
    state: result.ok ? result.state : undefined,
    error: result.ok ? undefined : result.error,
  });
}
