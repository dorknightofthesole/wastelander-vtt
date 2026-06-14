import { getSceneDocument } from "../scavenging/scenePersist.js";
import { DEFAULT_MILES_PER_HEX } from "./travelRules.js";

export type SceneGridDistance = {
  distance: number;
  units: string;
};

export function readSceneGridDistance(sceneId: string): SceneGridDistance {
  const scene = game.scenes.get(sceneId) ?? getSceneDocument(sceneId);
  const grid = scene?.grid as { distance?: number; units?: string } | undefined;
  const distance =
    typeof grid?.distance === "number" && grid.distance > 0
      ? grid.distance
      : DEFAULT_MILES_PER_HEX;
  const units = grid?.units?.trim() || "mi";
  return { distance, units };
}

/** Miles (or scene grid units) per hex from the scene configuration. */
export function getSceneMilesPerHex(sceneId: string): number {
  return readSceneGridDistance(sceneId).distance;
}

function formatDistanceNumber(distance: number): string {
  if (Number.isInteger(distance)) return String(distance);
  return distance.toFixed(4).replace(/\.?0+$/, "");
}

export function formatSceneGridDistanceLabel(sceneId: string): string {
  const { distance, units } = readSceneGridDistance(sceneId);
  return `${formatDistanceNumber(distance)} ${units}`;
}
