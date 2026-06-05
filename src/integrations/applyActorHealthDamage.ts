import { getWorldActor, updateWorldActor } from "./falloutActor.js";

export type ActorHealthSnapshot = {
  value: number;
  max: number;
};

/** Read current HP from a Fallout actor (character, robot, npc, creature). */
export function readActorHealth(actor: Actor): ActorHealthSnapshot | null {
  const health = (actor.system as { health?: { value?: number; max?: number } })
    .health;
  if (!health || typeof health.value !== "number") return null;

  const value = Math.floor(health.value);
  const max = Math.floor(
    typeof health.max === "number" && Number.isFinite(health.max)
      ? health.max
      : value,
  );
  return { value, max: Math.max(0, max) };
}

/** Subtract damage from `system.health.value` (clamped at 0). */
export async function applyActorHealthDamage(
  actorId: string,
  damage: number,
): Promise<{ before: number; after: number; max: number } | null> {
  const amount = Math.max(0, Math.floor(damage));
  if (amount <= 0) return null;

  const actor = getWorldActor(actorId);
  const health = readActorHealth(actor);
  if (!health) return null;

  const before = health.value;
  const after = Math.max(0, before - amount);

  await updateWorldActor(actorId, {
    "system.health.value": after,
  });

  return { before, after, max: health.max };
}
