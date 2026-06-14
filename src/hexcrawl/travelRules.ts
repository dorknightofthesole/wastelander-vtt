import navigationDifficulties from "../data/hexcrawl/navigation-difficulties.json";
import {
  readActorSpecial,
  type FalloutActorSystemSlice,
} from "../export/actorDerivedStats.js";

export const DEFAULT_MILES_PER_HEX = 6;
export const MAX_NAVIGATION_DIFFICULTY = 5;

export type NavigationCondition = {
  id: string;
  label: string;
  baseDifficulty: number;
};

export type CourseStatus = "onCourse" | "lost";

export const NAVIGATION_CONDITIONS = navigationDifficulties as NavigationCondition[];

export const ENCOUNTER_TYPE_TABLE = "Random Encounter Type";

export const ENCOUNTER_TABLE_BY_TYPE: Record<string, string> = {
  Ordinary: "Random Ordinary Encounters",
  Object: "Random Object Encounters",
  Campsite: "Random Campsite Encounters",
  "Choke Point": "Random Choke Point Encounters",
  Animosity: "Random Factions for Animosity Encounters",
};

export function mphForAgi(agi: number): number {
  if (agi <= 5) return 2;
  if (agi <= 8) return 3;
  return 4;
}

export function resolvePartyTravelMph(actorIds: string[]): number {
  let slowest = Infinity;
  for (const id of actorIds) {
    const actor = game.actors.get(id);
    if (!actor) continue;
    const system = actor.system as FalloutActorSystemSlice;
    const { agi } = readActorSpecial(system);
    slowest = Math.min(slowest, mphForAgi(agi));
  }
  return Number.isFinite(slowest) ? slowest : 3;
}

export function hexTravelMinutes(milesPerHex: number, mph: number): number {
  const miles = Math.max(0, milesPerHex);
  const speed = Math.max(0.25, mph);
  return Math.round((miles / speed) * 60);
}

export function resolveMaxHoursPerDay(actorIds: string[]): number {
  let lowestEnd = Infinity;
  for (const id of actorIds) {
    const actor = game.actors.get(id);
    if (!actor) continue;
    const system = actor.system as FalloutActorSystemSlice;
    const { end } = readActorSpecial(system);
    lowestEnd = Math.min(lowestEnd, end);
  }
  const end = Number.isFinite(lowestEnd) ? lowestEnd : 5;
  return Math.min(12, Math.max(1, end + 2));
}

/** @deprecated Use resolveMaxHoursPerDay */
export function defaultMaxHoursPerDay(actorIds: string[]): number {
  return resolveMaxHoursPerDay(actorIds);
}

function getSkillValue(actor: Actor, skillName: string): number {
  const item = actor.items.find(
    (i) => i.type === "skill" && i.name.toLowerCase() === skillName.toLowerCase(),
  );
  if (!item) return 0;
  const system = item.system as { value?: number; rank?: number };
  const value = Number(system.value ?? system.rank ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Navigator default: highest END + Survival. */
export function pickDefaultNavigatorActorId(actorIds: string[]): string | null {
  let best: { id: string; score: number; name: string } | null = null;
  for (const id of actorIds) {
    const actor = game.actors.get(id);
    if (!actor) continue;
    const system = actor.system as FalloutActorSystemSlice;
    const { end } = readActorSpecial(system);
    const survival = getSkillValue(actor, "Survival");
    const score = end + survival;
    const name = actor.name ?? id;
    if (
      !best ||
      score > best.score ||
      (score === best.score && name.localeCompare(best.name) < 0)
    ) {
      best = { id, score, name };
    }
  }
  return best?.id ?? actorIds[0] ?? null;
}

/** Whole hours traveled past the daily max (max 8, 9.2 h → 1). */
export function pastMaxWholeHours(
  hoursTraveled: number,
  maxHoursPerDay: number,
): number {
  return Math.max(0, Math.floor(hoursTraveled) - maxHoursPerDay);
}

/** Fatigue to award when travel hours increase (1 per new whole hour past max). */
export function computeTravelFatigueDelta(
  hoursBefore: number,
  hoursAfter: number,
  maxHoursPerDay: number,
): number {
  return (
    pastMaxWholeHours(hoursAfter, maxHoursPerDay) -
    pastMaxWholeHours(hoursBefore, maxHoursPerDay)
  );
}

export function navigationConditionById(id: string): NavigationCondition | undefined {
  return NAVIGATION_CONDITIONS.find((row) => row.id === id);
}

export function clampDifficulty(value: number): number {
  return Math.min(MAX_NAVIGATION_DIFFICULTY, Math.max(0, Math.floor(value)));
}

export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export type TravelEventMode = "hexEntry" | "hourChange";

export const TRAVEL_EVENT_MODES: TravelEventMode[] = ["hexEntry", "hourChange"];

export function normalizeTravelEventMode(raw: unknown): TravelEventMode {
  return raw === "hourChange" ? "hourChange" : "hexEntry";
}

/** Whole hours crossed when accumulating travel time (e.g. 1.2 → 2.1 crosses hour 2 once). */
export function countHourBoundariesCrossed(
  hoursBefore: number,
  hoursAfter: number,
): number {
  return Math.max(0, Math.floor(hoursAfter) - Math.floor(hoursBefore));
}

export function travelEncounterRollCount(
  mode: TravelEventMode,
  hoursBefore: number,
  hoursAfter: number,
  options: { onHexEntry: boolean },
): number {
  if (mode === "hexEntry" && options.onHexEntry) return 1;
  if (mode === "hourChange") {
    return countHourBoundariesCrossed(hoursBefore, hoursAfter);
  }
  return 0;
}
