import { readActorSpecial } from "../export/actorDerivedStats.js";
import type { FalloutActorSystemSlice } from "../export/actorDerivedStats.js";
import type {
  AssistSearchRollLog,
  ScavengerPlayerSearchState,
  SearchTeamRole,
} from "./playerSearchState.js";

function getSkillValue(actor: Actor, skillName: string): number {
  const item = actor.items.find(
    (i) => i.type === "skill" && i.name.toLowerCase() === skillName.toLowerCase(),
  );
  if (!item) return 0;
  const system = item.system as { value?: number; rank?: number };
  const value = Number(system.value ?? system.rank ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** PER + Survival target number for search tests. */
export function getPerSurvivalTargetNumber(actor: Actor): {
  per: number;
  survival: number;
  targetNumber: number;
} {
  const system = actor.system as FalloutActorSystemSlice;
  const { per } = readActorSpecial(system);
  const survival = getSkillValue(actor, "Survival");
  return { per, survival, targetNumber: per + survival };
}

/** Highest PER+Survival; tie → earliest actor name (localeCompare). */
export function pickDefaultPrimaryActorId(actorIds: string[]): string | null {
  let best: { id: string; score: number; name: string } | null = null;

  for (const id of actorIds) {
    const actor = game.actors.get(id);
    if (!actor) continue;
    const { targetNumber } = getPerSurvivalTargetNumber(actor);
    const name = actor.name ?? id;
    if (
      !best ||
      targetNumber > best.score ||
      (targetNumber === best.score && name.localeCompare(best.name) < 0)
    ) {
      best = { id, score: targetNumber, name };
    }
  }

  return best?.id ?? actorIds[0] ?? null;
}

export function getSearchTeamRole(
  state: ScavengerPlayerSearchState,
  actorId: string,
): SearchTeamRole {
  return state.teamRoles[actorId] ?? "none";
}

export function primaryActorId(state: ScavengerPlayerSearchState): string | null {
  for (const [actorId, role] of Object.entries(state.teamRoles)) {
    if (role === "primary") return actorId;
  }
  return null;
}

export function assistActorIds(state: ScavengerPlayerSearchState): string[] {
  return Object.entries(state.teamRoles)
    .filter(([, role]) => role === "assist")
    .map(([actorId]) => actorId);
}

/** Primary searcher and assistants assigned for this location's search. */
export function searchTeamActorIds(state: ScavengerPlayerSearchState): string[] {
  const ids: string[] = [];
  const primary = primaryActorId(state);
  if (primary) ids.push(primary);
  for (const id of assistActorIds(state)) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function isSearchTeamActor(
  state: ScavengerPlayerSearchState,
  actorId: string,
): boolean {
  const role = getSearchTeamRole(state, actorId);
  return role === "primary" || role === "assist";
}

export function searchTeamLocked(state: ScavengerPlayerSearchState): boolean {
  return Boolean(state.searchRollLog) || Object.keys(state.assistRolls).length > 0;
}

export function allAssistsHaveRolled(state: ScavengerPlayerSearchState): boolean {
  const assists = assistActorIds(state);
  if (!assists.length) return true;
  return assists.every((id) => Boolean(state.assistRolls[id]));
}

/** Resolve assist roster (uses synced team roles when party list is provided). */
export function requiredAssistActorIds(
  state: ScavengerPlayerSearchState,
  partyActorIds: string[] = [],
): string[] {
  const synced = partyActorIds.length
    ? ensureSearchTeam(state, partyActorIds)
    : state;
  return assistActorIds(synced);
}

/** True when any assist has not rolled yet (primary must wait). */
export function hasPendingAssistRolls(
  state: ScavengerPlayerSearchState,
  partyActorIds: string[] = [],
): boolean {
  const synced = partyActorIds.length
    ? ensureSearchTeam(state, partyActorIds)
    : state;
  const assists = assistActorIds(synced);
  if (!assists.length) return false;
  return assists.some((id) => !synced.assistRolls[id]);
}

export function primaryCanScavengeSearch(
  state: ScavengerPlayerSearchState,
  partyActorIds: string[] = [],
): boolean {
  if (state.searchRollLog) return false;
  return !hasPendingAssistRolls(state, partyActorIds);
}

/** Sum assist d20 successes (0–2 per assist, including crits on tagged skills). */
export function countAssistBonusSuccesses(state: ScavengerPlayerSearchState): number {
  return Object.values(state.assistRolls).reduce(
    (sum, roll) => sum + Math.max(0, roll.successes),
    0,
  );
}

/**
 * Keep teamRoles in sync with party (even after rolls start).
 * Does not reshuffle roles once searchTeamLocked unless entries are missing.
 */
export function ensureSearchTeam(
  state: ScavengerPlayerSearchState,
  partyActorIds: string[],
): ScavengerPlayerSearchState {
  if (state.searchSuccess !== null) {
    return state;
  }

  const teamRoles = { ...state.teamRoles };
  let changed = false;
  const primaryId =
    primaryActorId({ ...state, teamRoles }) ??
    pickDefaultPrimaryActorId(partyActorIds);

  if (!primaryId || !partyActorIds.length) {
    return state;
  }

  const locked = searchTeamLocked(state);
  const hadPrimary = Boolean(primaryActorId({ ...state, teamRoles }));

  for (const id of partyActorIds) {
    if (!(id in teamRoles)) {
      teamRoles[id] = id === primaryId ? "primary" : "assist";
      changed = true;
    }
  }

  for (const assistId of Object.keys(state.assistRolls)) {
    if (teamRoles[assistId] !== "primary" && teamRoles[assistId] !== "assist") {
      teamRoles[assistId] = "assist";
      changed = true;
    }
  }

  if (!locked && !hadPrimary) {
    for (const id of partyActorIds) {
      const desired: SearchTeamRole = id === primaryId ? "primary" : "assist";
      if (teamRoles[id] !== desired) {
        teamRoles[id] = desired;
        changed = true;
      }
    }
  }

  if (!changed) return state;
  return { ...state, teamRoles, updatedAt: Date.now() };
}

export function applySearchTeamRole(
  state: ScavengerPlayerSearchState,
  actorId: string,
  role: SearchTeamRole,
): ScavengerPlayerSearchState {
  const teamRoles = { ...state.teamRoles };
  const assistRolls = { ...state.assistRolls };

  if (role === "primary") {
    for (const id of Object.keys(teamRoles)) {
      if (teamRoles[id] === "primary") teamRoles[id] = "assist";
    }
    teamRoles[actorId] = "primary";
    delete assistRolls[actorId];
  } else if (role === "assist") {
    if (teamRoles[actorId] === "primary") {
      teamRoles[actorId] = "assist";
    } else {
      teamRoles[actorId] = "assist";
    }
  } else {
    teamRoles[actorId] = "none";
    delete assistRolls[actorId];
  }

  return {
    ...state,
    teamRoles,
    assistRolls,
    updatedAt: Date.now(),
  };
}

export function recordAssistRoll(
  state: ScavengerPlayerSearchState,
  log: AssistSearchRollLog,
): ScavengerPlayerSearchState {
  return {
    ...state,
    assistRolls: { ...state.assistRolls, [log.actorId]: log },
    updatedAt: Date.now(),
  };
}
