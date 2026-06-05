/** Origin that requires a Fallout `robot` actor sheet (Mister Handy). */
export const ROBOT_ONLY_ORIGIN_ID = "mister-handy";

export function isRobotActorType(actorType: string): boolean {
  return actorType === "robot";
}

/** Whether this origin may be chosen for the given Fallout actor document type. */
export function isOriginCompatibleWithActorType(
  originId: string,
  actorType: string,
): boolean {
  const robotOnly = originId === ROBOT_ONLY_ORIGIN_ID;
  const robot = isRobotActorType(actorType);
  return robotOnly ? robot : !robot;
}

export type OriginDisableReason = "robot-only" | "human-only";

export function getOriginDisableReason(
  originId: string,
  actorType: string,
): OriginDisableReason | null {
  if (isOriginCompatibleWithActorType(originId, actorType)) return null;
  return isRobotActorType(actorType) ? "human-only" : "robot-only";
}
