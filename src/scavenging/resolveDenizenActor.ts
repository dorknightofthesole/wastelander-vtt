import { findCompendiumUuidByName } from "../integrations/compendiumLookup.js";

/** Fallout actor compendiums to search (world + packs). */
const FALLOUT_ACTOR_PACK_IDS = [
  "fallout.npcs",
  "fallout.creatures",
  "fallout.ferals",
  "fallout.robots",
];

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

type DenizenActorType = "npc" | "creature" | "robot";

function findWorldActorUuid(
  name: string,
  actorType?: DenizenActorType,
): string | null {
  const lower = normalizeName(name);
  const actors = (game as { actors?: { values: () => Iterable<Actor> } }).actors;
  if (!actors) return null;
  for (const actor of actors.values()) {
    if (actor.name.trim().toLowerCase() !== lower) continue;
    if (actorType && actor.type !== actorType) continue;
    return actor.uuid;
  }
  return null;
}

async function findCompendiumActorUuid(
  name: string,
  actorType?: DenizenActorType,
): Promise<string | null> {
  for (const packId of FALLOUT_ACTOR_PACK_IDS) {
    const uuid = await findCompendiumUuidByName(packId, name, actorType);
    if (uuid) return uuid;
  }

  const packs = (game as { packs?: { values: () => Iterable<CompendiumCollection> } })
    .packs;
  if (!packs) return null;
  const lower = normalizeName(name);
  for (const pack of packs.values()) {
    if (pack.documentName !== "Actor") continue;
    const index = await pack.getIndex({ fields: ["uuid", "name", "type"] });
    const match = index.find((e) => {
      if (String(e.name).toLowerCase() !== lower) return false;
      if (!actorType) return true;
      return String((e as { type?: string }).type ?? "") === actorType;
    });
    if (match) return String((match as { uuid?: string }).uuid ?? "") || null;
  }
  return null;
}

/** World actor first, then Fallout compendiums (exact name). */
export async function findActorUuidForDenizen(
  name: string,
  foundryActorType: DenizenActorType,
): Promise<string | null> {
  return (
    findWorldActorUuid(name, foundryActorType) ??
    (await findCompendiumActorUuid(name, foundryActorType))
  );
}

export async function openActorByUuid(actorUuid: string): Promise<void> {
  let doc: Actor | null = null;
  try {
    const resolved = await fromUuid(actorUuid);
    doc = resolved instanceof Actor ? resolved : null;
  } catch {
    doc = null;
  }
  if (!doc?.sheet) {
    ui.notifications.warn(
      (game.i18n as { localize: (k: string) => string }).localize(
        "WASTELANDER.Scavenging.Inhabitants.ActorOpenFailed",
      ),
    );
    return;
  }
  await doc.sheet.render(true);
}
