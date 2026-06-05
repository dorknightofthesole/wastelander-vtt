import { t } from "../integrations/i18n.js";
import type {
  HazardKind,
  HazardOngoingTick,
  ObstacleType,
  ScavengerLocationProblems,
} from "./ScavengerLocation.js";

/** Booklet p.19: obstacle test difficulty by location level (max 5). */
export function getObstacleDifficulty(locationLevel: number): number {
  let diff = 1;
  if (locationLevel >= 6) diff += 1;
  if (locationLevel >= 11) diff += 1;
  if (locationLevel >= 16) diff += 1;
  if (locationLevel >= 21) diff += 1;
  return Math.min(5, diff);
}

/** Booklet p.19: occasional hazard damage per trigger. */
export function getOccasionalHazardDamageDc(locationLevel: number): number {
  return 3 + Math.floor(locationLevel / 4);
}

export const OBSTACLE_TYPES: ObstacleType[] = [
  "mechanical",
  "electronic",
  "collapsed",
  "trap",
];

export const HAZARD_KINDS: HazardKind[] = ["ongoing", "occasional"];

/** Booklet: deliberate traps use obstacle diff 2; others scale with location level. */
export function getObstacleDifficultyForType(
  type: ObstacleType,
  locationLevel: number,
): number {
  if (type === "trap") return 2;
  return getObstacleDifficulty(locationLevel);
}

/** Minutes to bypass (10 × difficulty); halvable with 2 AP after success. */
export function getObstacleBypassMinutes(difficulty: number): number {
  return difficulty * 10;
}

/** Infer hazard kind from new fields or legacy `hazardOngoing` saves. */
export function normalizeHazardKind(
  problems: ScavengerLocationProblems,
  locationLevel: number,
): HazardKind {
  if (problems.hazardKind === "ongoing" || problems.hazardKind === "occasional") {
    return problems.hazardKind;
  }
  if (problems.hazardOngoing === true) return "ongoing";
  // Legacy bug: level 11+ stored hazardOngoing=false but meant faster ongoing ticks.
  if (problems.hazardOngoing === false && locationLevel >= 11) return "ongoing";
  if (problems.hazardOngoing === false) return "occasional";
  return "ongoing";
}

export function getHazardOngoingTick(locationLevel: number): HazardOngoingTick {
  return locationLevel >= 11 ? "perMin" : "per10min";
}

/** Apply booklet math when a location is generated (or when re-normalizing). */
export function resolveLocationProblems(
  problems: ScavengerLocationProblems,
  locationLevel: number,
): ScavengerLocationProblems {
  const p: ScavengerLocationProblems = { ...problems };

  if (p.obstacle) {
    const type = p.obstacleType ?? "mechanical";
    p.obstacleType = type;
    p.obstacleDifficulty = getObstacleDifficultyForType(type, locationLevel);
    p.obstacleBypassMinutes = getObstacleBypassMinutes(p.obstacleDifficulty);
    if (p.obstacleOvercome === undefined) p.obstacleOvercome = false;
  } else {
    delete p.obstacleType;
    delete p.obstacleDifficulty;
    delete p.obstacleBypassMinutes;
    delete p.obstacleOvercome;
  }

  if (p.hazard) {
    const kind = normalizeHazardKind(p, locationLevel);
    p.hazardKind = kind;
    delete p.hazardOngoing;

    if (kind === "ongoing") {
      p.hazardOngoingTick = getHazardOngoingTick(locationLevel);
      delete p.hazardDamageDc;
    } else {
      p.hazardDamageDc = getOccasionalHazardDamageDc(locationLevel);
      delete p.hazardOngoingTick;
    }
  } else {
    delete p.hazardKind;
    delete p.hazardOngoingTick;
    delete p.hazardDamageDc;
    delete p.hazardOngoing;
  }

  return p;
}

export type ProblemSummaryLabels = {
  obstacleTypeLabel: string;
  obstacleSkillLabel: string;
  hazardKindLabel: string;
  obstacleOvercomeNote?: string;
  obstacleNotOvercomeNote?: string;
};

export function formatObstacleSummary(
  problems: ScavengerLocationProblems,
  labels: ProblemSummaryLabels,
): string {
  if (!problems.obstacle) return "";
  const diff = problems.obstacleDifficulty ?? "—";
  const bypass = problems.obstacleBypassMinutes ?? "—";
  const overcome = problems.obstacleOvercome
    ? labels.obstacleOvercomeNote ?? ""
    : labels.obstacleNotOvercomeNote ?? "";
  return `${labels.obstacleTypeLabel}: ${labels.obstacleSkillLabel}, difficulty ${diff}, ~${bypass} min to bypass${overcome}`;
}

/** Merge Create-tab form toggles with a generated location without wiping stored sub-fields. */
export function problemsForProblemUi(
  formProblems: ScavengerLocationProblems,
  location: { level: number; problems: ScavengerLocationProblems } | null,
): { problems: ScavengerLocationProblems; level: number } {
  const level = location?.level ?? 1;
  if (location) {
    const stored = location.problems;
    return {
      problems: resolveLocationProblems(
        {
          ...stored,
          hazard: formProblems.hazard,
          obstacle: formProblems.obstacle,
          inhabitants: formProblems.inhabitants,
          hazardKind: formProblems.hazardKind ?? stored.hazardKind,
          obstacleType: formProblems.obstacleType ?? stored.obstacleType,
          inhabitantType: formProblems.inhabitantType ?? stored.inhabitantType,
        },
        level,
      ),
      level,
    };
  }
  return {
    problems: resolveLocationProblems(
      {
        ...formProblems,
        hazardKind: formProblems.hazardKind ?? "ongoing",
        obstacleType: formProblems.obstacleType ?? "mechanical",
      },
      level,
    ),
  };
}

export function formatHazardSummary(
  problems: ScavengerLocationProblems,
  locationLevel: number,
): string {
  if (!problems.hazard) return "";
  const kind = normalizeHazardKind(problems, locationLevel);
  if (kind === "ongoing") {
    const perMin =
      (problems.hazardOngoingTick ?? getHazardOngoingTick(locationLevel)) ===
      "perMin";
    return t(
      perMin
        ? "WASTELANDER.Scavenging.Problems.HazardSummaryOngoingPerMin"
        : "WASTELANDER.Scavenging.Problems.HazardSummaryOngoingPer10Min",
    );
  }
  return t("WASTELANDER.Scavenging.Problems.HazardSummaryOccasional");
}

export function canSearchLocation(problems: ScavengerLocationProblems): boolean {
  if (!problems.obstacle) return true;
  return Boolean(problems.obstacleOvercome);
}
