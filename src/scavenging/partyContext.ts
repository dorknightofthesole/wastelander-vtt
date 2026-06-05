import type { PartyActorRow } from "./ScavengerLocation.js";
import { getActiveSceneId } from "./scenePersist.js";

type UserDocument = {
  id: string;
  name: string;
  isGM: boolean;
  active: boolean;
  character?: { id: string } | string | null;
};

type CanvasToken = {
  document: {
    actorId: string | null;
    actorLink: boolean;
  };
  actor?: Actor | null;
};

/**
 * Party = each non-GM user's assigned character with a linked token on the scene.
 * Players do not need to be logged in (offline users still count).
 */
export function getPartyActorsOnScene(sceneId?: string | null): PartyActorRow[] {
  const targetSceneId = sceneId ?? getActiveSceneId();
  if (!targetSceneId) return [];

  const linkedActorIds = getLinkedActorIdsOnScene(targetSceneId);
  if (linkedActorIds.size === 0) return [];

  const users = getGameUsers().filter((u) => !u.isGM);
  const rows: PartyActorRow[] = [];
  const seen = new Set<string>();

  for (const actorId of linkedActorIds) {
    if (seen.has(actorId)) continue;
    const actor = game.actors.get(actorId);
    if (!actor) continue;

    const user = findOwningUserForActor(actorId, users, actor);
    if (!user) continue;

    seen.add(actorId);
    rows.push({
      actorId,
      actorName: actor.name,
      userId: user.id,
      userName: user.name,
      userActive: user.active,
      level: getActorLevel(actor),
      selected: true,
    });
  }

  return rows.sort((a, b) => a.userName.localeCompare(b.userName));
}

export function sumSelectedPartyLevels(rows: PartyActorRow[]): number {
  return rows.filter((r) => r.selected).reduce((sum, r) => sum + r.level, 0);
}

export function countSelectedParty(rows: PartyActorRow[]): number {
  return rows.filter((r) => r.selected).length;
}

function findOwningUserForActor(
  actorId: string,
  users: UserDocument[],
  actor: Actor,
): UserDocument | undefined {
  for (const user of users) {
    if (getUserCharacterId(user) === actorId) return user;
  }

  for (const user of users) {
    if (actorOwnsUser(actor, user)) return user;
  }

  return undefined;
}

function actorOwnsUser(actor: Actor, user: UserDocument): boolean {
  const test = (actor as { testUserPermission?: (u: UserDocument, level: string) => boolean })
    .testUserPermission;
  if (typeof test === "function") {
    try {
      return test.call(actor, user, "OWNER");
    } catch {
      return false;
    }
  }
  const ownership = (actor as { ownership?: Record<string, number> }).ownership;
  if (ownership && user.id in ownership) {
    return ownership[user.id] === 3;
  }
  return false;
}

function getUserCharacterId(user: UserDocument): string | null {
  const ch = user.character;
  if (!ch) return null;
  if (typeof ch === "string") return ch;
  return ch.id ?? null;
}

function getActorLevel(actor: Actor): number {
  const system = actor.system as { level?: { value?: number } };
  const level = Number(system.level?.value ?? 1);
  return Number.isFinite(level) && level >= 1 ? level : 1;
}

/** Linked actor tokens on the viewed scene (canvas is authoritative when the scene is open). */
function getLinkedActorIdsOnScene(sceneId: string): Set<string> {
  const ids = new Set<string>();
  const canvas = (globalThis as { canvas?: { scene?: { id: string } | null; tokens?: { placeables: CanvasToken[] } } })
    .canvas;

  if (canvas?.scene?.id === sceneId && canvas.tokens?.placeables) {
    for (const token of canvas.tokens.placeables) {
      const doc = token.document;
      if (doc.actorLink && doc.actorId) ids.add(doc.actorId);
    }
    if (ids.size > 0) return ids;
  }

  const scene = (game as { scenes?: { get: (id: string) => SceneWithTokens | undefined } }).scenes?.get(
    sceneId,
  );
  const tokens = scene?.tokens;
  if (tokens) {
    if (Array.isArray(tokens)) {
      for (const t of tokens) {
        if (t.actorLink && t.actorId) ids.add(t.actorId);
      }
    } else if (typeof tokens === "object") {
      for (const t of Object.values(tokens as Record<string, { actorLink?: boolean; actorId?: string | null }>)) {
        if (t.actorLink && t.actorId) ids.add(t.actorId);
      }
    }
  }

  return ids;
}

type SceneWithTokens = {
  tokens?: Array<{ actorId: string | null; actorLink: boolean }> | Record<string, { actorLink?: boolean; actorId?: string | null }>;
};

function getGameUsers(): UserDocument[] {
  const users = (game as { users?: { contents?: UserDocument[] } }).users;
  return users?.contents ?? [];
}
