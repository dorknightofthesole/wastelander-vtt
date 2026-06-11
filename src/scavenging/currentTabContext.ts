import { t } from "../integrations/i18n.js";
import {
  buildHazardDamageUi,
  type HazardDamageUi,
} from "./hazardDamage.js";
import {
  formatInhabitantCountSummary,
  inhabitantTypeLabel,
} from "./inhabitantRules.js";
import { SEARCH_TIME_BY_SCALE } from "./locationRules.js";
import { getCategoryOptions } from "./locationGenerator.js";
import type {
  PartyActorRow,
  ScavengerLocation,
  ScavengerLocationProblems,
} from "./ScavengerLocation.js";
import {
  getMaxCapsForLocationLevel,
  isLootValueFilterEnabled,
} from "./lootValueCap.js";
import {
  formatHazardSummary,
  formatObstacleSummary,
  normalizeHazardKind,
  problemsForProblemUi,
  resolveLocationProblems,
} from "./problemRules.js";

export type CurrentTabContext = {
  empty: boolean;
  name?: string;
  concept?: string;
  scaleLabel?: string;
  categoryLabel?: string;
  degreeLabel?: string;
  generated?: {
    level: string;
    searchDifficulty: number;
    searchMinutes: number;
    searchTimeLabel: string;
  };
  inhabitants?: {
    countSummary: string | null;
    typeLabel: string;
    overseerOverride: boolean;
    rosterEmpty: boolean;
    roster: {
      name: string;
      level: number;
      actorUuid: string | null;
      sizeLabel: string;
    }[];
  } | null;
  hazard: {
    present: boolean;
    kindLabel?: string;
    summary?: string;
    damageUi?: HazardDamageUi & { formulaHintHtml?: string };
  };
  obstacle: {
    present: boolean;
    summary?: string;
    showOvercome: boolean;
    overcome: boolean;
  };
  lootValueCap?: {
    enabled: boolean;
    maxCaps?: number;
    disabledLabel: string;
    enabledLabel: string;
  };
};

export function problemSummaryLabelBase() {
  return {
    obstacleTypeLabel: "",
    obstacleSkillLabel: "",
    hazardKindLabel: "",
    obstacleOvercomeNote: ` (${t("WASTELANDER.Scavenging.Problems.ObstacleOvercome")})`,
    obstacleNotOvercomeNote: ` (${t("WASTELANDER.Scavenging.Problems.ObstacleNotOvercome")})`,
  };
}

/** Same data shape as the Overseer app Current tab. */
export function buildCurrentTabContext(
  location: ScavengerLocation | null,
  formProblems?: ScavengerLocationProblems,
  options?: { sceneId?: string | null; party?: PartyActorRow[] },
): CurrentTabContext {
  if (!location) {
    return {
      empty: true,
      hazard: { present: false },
      obstacle: { present: false },
    };
  }

  const scaleLabel =
    location.scale.charAt(0).toUpperCase() + location.scale.slice(1);
  const degreeLabel =
    location.degree.charAt(0).toUpperCase() + location.degree.slice(1);
  const category =
    getCategoryOptions().find((c) => c.id === location.categoryId)?.label ??
    location.categoryId;
  const searchTime = SEARCH_TIME_BY_SCALE[location.scale];

  const display = formProblems
    ? problemsForProblemUi(formProblems, location)
    : { problems: location.problems, level: location.level };
  const p = resolveLocationProblems(display.problems, display.level);
  const base = problemSummaryLabelBase();
  const obstacle = {
    present: Boolean(p.obstacle),
    summary: p.obstacle
      ? formatObstacleSummary(p, {
          ...base,
          obstacleTypeLabel: t(
            `WASTELANDER.Scavenging.Problems.ObstacleTypes.${p.obstacleType ?? "mechanical"}`,
          ),
          obstacleSkillLabel: t(
            `WASTELANDER.Scavenging.Problems.ObstacleSkills.${p.obstacleType ?? "mechanical"}`,
          ),
        })
      : undefined,
    showOvercome: Boolean(p.obstacle),
    overcome: Boolean(p.obstacleOvercome),
  };
  const hazardKind = p.hazard
    ? normalizeHazardKind(p, location.level)
    : null;
  const hazard = {
    present: Boolean(p.hazard),
    kindLabel: hazardKind
      ? t(`WASTELANDER.Scavenging.Problems.HazardKinds.${hazardKind}`)
      : undefined,
    summary: p.hazard ? formatHazardSummary(p, location.level) : undefined,
    damageUi: p.hazard
      ? buildHazardDamageUi(
          location,
          options?.sceneId ?? location.sceneId ?? null,
          formProblems,
          options?.party,
        )
      : undefined,
  };

  const inh = location.inhabitants;
  let inhabitants: CurrentTabContext["inhabitants"] = null;
  if (inh) {
    const isOverseerOverride = inh.type === "overseerOverride";
    inhabitants = {
      countSummary: formatInhabitantCountSummary(inh, location.level),
      typeLabel: inhabitantTypeLabel(inh.type),
      overseerOverride: isOverseerOverride,
      rosterEmpty: !isOverseerOverride && inh.roster.length === 0,
      roster: inh.roster.map((r) => ({
        name: r.name,
        level: r.level,
        actorUuid: r.foundryUuid ?? null,
        sizeLabel: r.npcSize
          ? t(`WASTELANDER.Scavenging.Inhabitants.Size.${r.npcSize}`)
          : "",
      })),
    };
  }

  const filterEnabled = isLootValueFilterEnabled();
  const lootValueCap = {
    enabled: filterEnabled,
    maxCaps: filterEnabled ? getMaxCapsForLocationLevel(location.level) : undefined,
    disabledLabel: t("WASTELANDER.Scavenging.Loot.ValueFilterDisabled"),
    enabledLabel: t("WASTELANDER.Scavenging.Loot.ValueFilterEnabled", {
      maxCaps: getMaxCapsForLocationLevel(location.level),
    }),
  };

  return {
    empty: false,
    name: location.name,
    concept: location.concept,
    scaleLabel,
    categoryLabel: category,
    degreeLabel,
    generated: {
      level: String(location.level),
      searchDifficulty: location.searchDifficulty,
      searchMinutes: location.searchMinutes,
      searchTimeLabel: searchTime.label,
    },
    inhabitants,
    hazard,
    obstacle,
    lootValueCap,
  };
}
