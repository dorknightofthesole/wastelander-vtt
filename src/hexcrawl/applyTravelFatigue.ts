import { updateWorldActor, refreshActorSheet } from "../integrations/falloutActor.js";

type FalloutConditionsSlice = {
  conditions?: { fatigue?: number };
};

export function readActorFatigue(actor: Actor): number | null {
  const fatigue = (actor.system as FalloutConditionsSlice).conditions?.fatigue;
  return typeof fatigue === "number" && Number.isFinite(fatigue) ? Math.max(0, fatigue) : null;
}

export async function applyActorFatigue(
  actorId: string,
  amount: number,
): Promise<number | null> {
  const delta = Math.max(0, Math.floor(amount));
  if (delta <= 0) return null;

  const actor = game.actors.get(actorId);
  if (!actor) return null;
  const current = readActorFatigue(actor);
  if (current == null) return null;

  const next = current + delta;
  await updateWorldActor(actorId, { "system.conditions.fatigue": next });
  refreshActorSheet(actor);
  return next;
}

export async function applyPartyTravelFatigue(
  partyActorIds: string[],
  amount: number,
): Promise<void> {
  const delta = Math.max(0, Math.floor(amount));
  if (delta <= 0) return;

  const unique = [...new Set(partyActorIds)];
  await Promise.all(unique.map((actorId) => applyActorFatigue(actorId, delta)));
}
