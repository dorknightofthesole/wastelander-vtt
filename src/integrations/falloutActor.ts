const SILENT = { render: false } as const;

/**
 * World Actor from the sidebar — not a synthetic token actor (`actor.isToken`).
 */
export function getWorldActor(actorId: string): Actor {
  const doc = game.actors.get(actorId);
  if (!doc) {
    throw new Error("Actor not found in the Actors sidebar.");
  }
  if (doc.isToken) {
    throw new Error(
      "Open the character from the Actors sidebar (or a linked token), not an unlinked scene token.",
    );
  }
  return doc;
}

/**
 * Resolve the world Actor id used for database writes.
 */
export function resolveActorId(actor: Actor): string {
  if (!actor?.id) {
    throw new Error("Invalid actor.");
  }

  const fromCollection = game.actors.get(actor.id);
  if (fromCollection && !fromCollection.isToken) {
    return fromCollection.id;
  }

  const token = actor.token;
  if (token?.document?.actorLink) {
    const linked = game.actors.get(token.document.actorId);
    if (linked && !linked.isToken) return linked.id;
  }

  throw new Error(
    "Open the character from the Actors sidebar (or a linked token), not an unlinked scene token.",
  );
}

export function resolveActor(actor: Actor): Actor {
  return getWorldActor(resolveActorId(actor));
}

/**
 * Update a world Actor by id. Avoids `actor.update()` on a synthetic reference, which
 * sets `operation.parent` to a TokenDocument and can break the update pipeline.
 */
export async function updateWorldActor(
  actorId: string,
  data: Record<string, unknown>,
): Promise<void> {
  getWorldActor(actorId);
  await Actor.implementation.updateDocuments(
    [{ _id: actorId, ...data }],
    SILENT,
  );
}

type RenderableActorSheet = {
  rendered?: boolean;
  render?: (force?: boolean) => Promise<unknown>;
};

/** Re-render open actor sheets after silent embedded-document updates. */
export function refreshActorSheet(actor: Actor): void {
  const sheets = new Set<RenderableActorSheet>();

  const queue = (doc: Actor | null | undefined): void => {
    const sheet = doc?.sheet as RenderableActorSheet | null | undefined;
    if (sheet?.rendered && sheet.render) sheets.add(sheet);
  };

  queue(actor);
  try {
    queue(resolveActor(actor));
  } catch {
    // ignore token-only references
  }

  let worldId: string | undefined;
  try {
    worldId = resolveActorId(actor);
  } catch {
    worldId = actor.id;
  }

  const tokens = (
    globalThis as {
      canvas?: {
        scene?: {
          tokens?: Map<string, { document: { actorLink: boolean; actorId: string }; actor?: Actor }>;
        };
      };
    }
  ).canvas?.scene?.tokens;

  if (tokens && worldId) {
    for (const token of tokens.values()) {
      const doc = token.document;
      if (!doc?.actorLink || doc.actorId !== worldId) continue;
      queue(token.actor);
    }
  }

  for (const sheet of sheets) {
    void sheet.render?.(true);
  }
}
