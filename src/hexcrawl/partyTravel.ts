import { isOverseer } from "../integrations/overseerAccess.js";
import { userControlsActor } from "../scavenging/partyContext.js";
import {
  readActorSpecial,
  type FalloutActorSystemSlice,
} from "../export/actorDerivedStats.js";
import { findSceneTokenIdForActor } from "./hexCoords.js";
import type { HexcrawlSceneState } from "./hexcrawlScenePersist.js";
import {
  pickDefaultNavigatorActorId,
  resolvePartyTravelMph,
  resolveMaxHoursPerDay,
} from "./travelRules.js";

export type PartyMemberRow = {
  actorId: string;
  actorName: string;
  isNavigator: boolean;
  isPace: boolean;
  setsMaxHours: boolean;
  canRemove: boolean;
};

export type PartyTravelRoles = {
  navigatorActorId: string | null;
  navigatorName: string | null;
  paceActorId: string | null;
  paceName: string | null;
  hoursActorId: string | null;
  hoursActorName: string | null;
  partyMph: number;
  maxHoursPerDay: number;
};

const HEXCRAWL_PARTY_ACTOR_TYPES = new Set(["character", "robot", "creature"]);
const HEXCRAWL_TRAVEL_ROLE_ACTOR_TYPES = new Set(["character", "robot"]);

/** PC sheets and animal companions (e.g. Dogmeat) that may join the travel party. */
export function isHexcrawlPartyEligibleActor(actor: Actor): boolean {
  if (HEXCRAWL_PARTY_ACTOR_TYPES.has(actor.type)) return true;
  return actor.name?.trim().toLowerCase() === "dogmeat";
}

/** PCs whose SPECIAL stats set navigator, pace, and max travel hours. */
export function filterHexcrawlTravelRoleActorIds(actorIds: string[]): string[] {
  return actorIds.filter((id) => {
    const actor = game.actors.get(id);
    return Boolean(actor && HEXCRAWL_TRAVEL_ROLE_ACTOR_TYPES.has(actor.type));
  });
}

function actorName(actorId: string): string {
  return game.actors.get(actorId)?.name ?? actorId;
}

function readAgi(actorId: string): number {
  const actor = game.actors.get(actorId);
  if (!actor) return 99;
  const { agi } = readActorSpecial(actor.system as FalloutActorSystemSlice);
  return agi;
}

function readEnd(actorId: string): number {
  const actor = game.actors.get(actorId);
  if (!actor) return 99;
  const { end } = readActorSpecial(actor.system as FalloutActorSystemSlice);
  return end;
}

/** Party pace: lowest AGI sets mph (may differ from navigator). */
export function pickPaceActorId(actorIds: string[]): string | null {
  if (!actorIds.length) return null;
  let best: { id: string; agi: number; name: string } | null = null;
  for (const id of actorIds) {
    const agi = readAgi(id);
    const name = actorName(id);
    if (
      !best ||
      agi < best.agi ||
      (agi === best.agi && name.localeCompare(best.name) < 0)
    ) {
      best = { id, agi, name };
    }
  }
  return best?.id ?? actorIds[0] ?? null;
}

/** Max travel hours: lowest END + 2. */
export function pickMaxHoursActorId(actorIds: string[]): string | null {
  if (!actorIds.length) return null;
  let best: { id: string; end: number; name: string } | null = null;
  for (const id of actorIds) {
    const end = readEnd(id);
    const name = actorName(id);
    if (
      !best ||
      end < best.end ||
      (end === best.end && name.localeCompare(best.name) < 0)
    ) {
      best = { id, end, name };
    }
  }
  return best?.id ?? actorIds[0] ?? null;
}

export function resolvePartyTravelRoles(actorIds: string[]): PartyTravelRoles {
  const ids = [...new Set(actorIds)].filter((id) => Boolean(game.actors.get(id)));
  const roleIds = filterHexcrawlTravelRoleActorIds(ids);
  const navigatorActorId = pickDefaultNavigatorActorId(roleIds);
  const paceActorId = pickPaceActorId(roleIds);
  const hoursActorId = pickMaxHoursActorId(roleIds);
  return {
    navigatorActorId,
    navigatorName: navigatorActorId ? actorName(navigatorActorId) : null,
    paceActorId,
    paceName: paceActorId ? actorName(paceActorId) : null,
    hoursActorId,
    hoursActorName: hoursActorId ? actorName(hoursActorId) : null,
    partyMph: resolvePartyTravelMph(roleIds),
    maxHoursPerDay: resolveMaxHoursPerDay(roleIds),
  };
}

export function syncPartyTravelState(
  state: HexcrawlSceneState,
  sceneId: string,
): HexcrawlSceneState {
  const partyActorIds = [...new Set(state.partyActorIds)].filter((id) =>
    Boolean(game.actors.get(id)),
  );
  const roles = resolvePartyTravelRoles(partyActorIds);
  const travelTokenId =
    roles.navigatorActorId && sceneId
      ? (findSceneTokenIdForActor(sceneId, roles.navigatorActorId) ??
        state.travelTokenId)
      : state.travelTokenId;

  return {
    ...state,
    partyActorIds,
    navigatorActorId: roles.navigatorActorId,
    maxHoursPerDay: roles.maxHoursPerDay,
    travelTokenId,
  };
}

export function buildPartyMemberRows(
  state: HexcrawlSceneState,
  options: { sceneId: string | null; userId: string; isOverseer: boolean },
): PartyMemberRow[] {
  const roles = resolvePartyTravelRoles(state.partyActorIds);
  return state.partyActorIds.map((actorId) => ({
    actorId,
    actorName: actorName(actorId),
    isNavigator: actorId === roles.navigatorActorId,
    isPace: actorId === roles.paceActorId,
    setsMaxHours: actorId === roles.hoursActorId,
    canRemove:
      options.isOverseer ||
      userControlsActor(actorId, options.userId, options.sceneId ?? undefined),
  }));
}

type DragActorPayload = {
  type?: string;
  uuid?: string;
  id?: string;
};

export async function resolveActorIdFromDrop(
  event: DragEvent,
): Promise<string | null> {
  const raw = event.dataTransfer?.getData("text/plain");
  if (!raw) return null;

  let data: DragActorPayload;
  try {
    data = JSON.parse(raw) as DragActorPayload;
  } catch {
    return null;
  }

  if (data.type !== "Actor") return null;

  if (data.uuid) {
    try {
      const doc = await fromUuid(data.uuid);
      if (doc instanceof Actor) return doc.id;
    } catch {
      return null;
    }
  }

  if (data.id) {
    const actor = game.actors.get(String(data.id));
    return actor?.id ?? null;
  }

  return null;
}

export function canAddActorToParty(
  actorId: string,
  sceneId: string | null,
  userId: string,
): boolean {
  const actor = game.actors.get(actorId);
  if (!actor || !isHexcrawlPartyEligibleActor(actor)) return false;
  const requester = game.users.get(userId) as { isGM?: boolean; role?: number } | undefined;
  if (isOverseer(requester)) return true;
  return userControlsActor(actorId, userId, sceneId ?? undefined);
}

export function addActorToPartyIds(
  partyActorIds: string[],
  actorId: string,
): string[] {
  if (partyActorIds.includes(actorId)) return partyActorIds;
  return [...partyActorIds, actorId];
}

export function removeActorFromPartyIds(
  partyActorIds: string[],
  actorId: string,
): string[] {
  return partyActorIds.filter((id) => id !== actorId);
}
