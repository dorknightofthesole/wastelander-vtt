import { MODULE_ID } from "../constants.js";
import type { ScavengerLocation } from "./ScavengerLocation.js";
import { resolveLocationProblems } from "./problemRules.js";

const FLAG_KEY = "scavengerLocation";

export function locationFromJournalPage(page: {
  getFlag: (scope: string, key: string) => unknown;
}): ScavengerLocation | null {
  const raw = page.getFlag(MODULE_ID, FLAG_KEY);
  if (!raw || typeof raw !== "object") return null;
  return raw as ScavengerLocation;
}

/** @deprecated Use automatic sync via {@link flushScavengerJournalSync}. */
export async function saveLocationToJournal(
  location: ScavengerLocation,
): Promise<ScavengerLocation> {
  const sceneId = location.sceneId?.trim();
  if (!sceneId) {
    throw new Error("Location has no sceneId for journal sync.");
  }
  const { flushScavengerJournalSync } = await import("./scavengerJournalSync.js");
  await flushScavengerJournalSync(sceneId);
  return {
    ...location,
    problems: resolveLocationProblems(location.problems, location.level),
  };
}
