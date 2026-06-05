import countData from "../data/scavenging/inhabitant-count.json";
import type {
  InhabitantRosterEntry,
  InhabitantType,
  LocationScale,
  ScavengerLocationInhabitants,
  ScavengerLocationRollLog,
} from "./ScavengerLocation.js";
import { evaluateFoundryRoll } from "../integrations/foundryRoll.js";
import { postInhabitantCountRollChat } from "./scavengerRollChat.js";
import {
  filterDenizensByLevelBand,
  filterDenizensByType,
  loadDenizens,
  type DenizenEntry,
  type NpcSize,
} from "./loadDenizens.js";
import { findActorUuidForDenizen } from "./resolveDenizenActor.js";
import { t } from "../integrations/i18n.js";

type RangeOutcome = { min: number; max: number; count: number };
type FaceOutcome = { face: number; count: number };

type ScaleCountDef =
  | { formula: string; outcomes: RangeOutcome[] }
  | { formula: string; outcomes: FaceOutcome[] };

const COUNT_TABLE = countData as Record<"small" | "average" | "large", ScaleCountDef>;

export function canHaveInhabitants(scale: LocationScale): boolean {
  return scale !== "tiny";
}

function firstDieFaceFromRoll(roll: Roll): number {
  for (const term of roll.terms ?? []) {
    const results = (term as { results?: Array<{ result?: number; active?: boolean }> })
      .results;
    if (!results?.length) continue;
    const active = results.find((r) => r.active !== false) ?? results[0];
    const face = Number(active?.result);
    if (Number.isFinite(face) && face >= 1) return Math.floor(face);
  }
  const total = Number(roll.total);
  if (Number.isFinite(total) && total >= 1) return Math.floor(total);
  return 1;
}

function resolveCountFromRoll(
  scale: "small" | "average" | "large",
  dieTotal: number,
): number {
  const def = COUNT_TABLE[scale];
  for (const outcome of def.outcomes) {
    if ("face" in outcome) {
      if (outcome.face === dieTotal) return outcome.count;
    } else if (dieTotal >= outcome.min && dieTotal <= outcome.max) {
      return outcome.count;
    }
  }
  return def.outcomes[def.outcomes.length - 1]!.count;
}

export async function rollInhabitantCount(
  scale: LocationScale,
  options?: { animate?: boolean },
): Promise<{
  count: number;
  rollLog: ScavengerLocationRollLog;
}> {
  if (scale === "tiny") {
    return {
      count: 0,
      rollLog: {
        id: "inhabitant-count",
        label: "Inhabitant count",
        detail: "Tiny locations cannot have inhabitants",
        total: 0,
      },
    };
  }

  const def = COUNT_TABLE[scale];
  const present = options?.animate !== false;
  const roll = await evaluateFoundryRoll(def.formula, { animate: false });
  const dieFace = firstDieFaceFromRoll(roll);
  const count = resolveCountFromRoll(scale, dieFace);

  if (present) {
    await postInhabitantCountRollChat({
      roll,
      formula: def.formula,
      dieFace,
      count,
      animate: true,
    });
  }

  return {
    count,
    rollLog: {
      id: "inhabitant-count",
      label: "Inhabitant count",
      formula: def.formula,
      total: count,
      detail: `Rolled ${dieFace} on ${def.formula} → ${count} inhabitants`,
    },
  };
}

function homogeneousNpcSize(roster: DenizenEntry[]): NpcSize | "mixed" | null {
  if (!roster.length) return null;
  const sizes = new Set(roster.map((r) => r.npcSize));
  if (sizes.size !== 1) return "mixed";
  return sizes.values().next().value ?? null;
}

export function applyNpcSizeToCount(baseCount: number, size: NpcSize | "mixed" | null): {
  count: number;
  modifierNote?: string;
} {
  if (size === "big") {
    const count = Math.max(1, Math.floor(baseCount / 2));
    return {
      count,
      modifierNote: `Big NPC — halved (${baseCount} → ${count})`,
    };
  }
  if (size === "little") {
    const count = baseCount * 2;
    return {
      count,
      modifierNote: `Little NPC — doubled (${baseCount} → ${count})`,
    };
  }
  return { count: baseCount };
}

function sampleDenizens(pool: DenizenEntry[], count: number): DenizenEntry[] {
  if (!pool.length || count <= 0) return [];
  const roster: DenizenEntry[] = [];
  for (let i = 0; i < count; i++) {
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    roster.push(pick);
  }
  return roster;
}

async function toRosterEntry(entry: DenizenEntry): Promise<InhabitantRosterEntry> {
  const foundryUuid = await findActorUuidForDenizen(
    entry.name,
    entry.foundryActorType,
  );
  return {
    denizenId: entry.id,
    name: entry.name,
    level: entry.level,
    role: "normal",
    npcSize: entry.npcSize,
    foundryUuid,
  };
}

export function formatLocationLevelOrdinal(level: number): string {
  const n = Math.max(1, Math.floor(level));
  const mod100 = n % 100;
  const mod10 = n % 10;
  let suffix = "th";
  if (mod100 < 11 || mod100 > 13) {
    if (mod10 === 1) suffix = "st";
    else if (mod10 === 2) suffix = "nd";
    else if (mod10 === 3) suffix = "rd";
  }
  return `${n}${suffix}`;
}

export function inhabitantLevelBand(locationLevel: number): { min: number; max: number } {
  const max = Math.max(1, Math.floor(locationLevel));
  return { min: Math.max(1, max - 2), max };
}

export function formatInhabitantCountSummary(
  inh: { count: number; baseCount: number },
  locationLevel: number,
): string {
  const levelOrdinal = formatLocationLevelOrdinal(locationLevel);
  if (inh.baseCount !== inh.count) {
    return t("WASTELANDER.Scavenging.Inhabitants.CountSummaryAdjustedAtLevel", {
      count: inh.count,
      baseCount: inh.baseCount,
      levelOrdinal,
    });
  }
  return t("WASTELANDER.Scavenging.Inhabitants.CountSummaryAtLevel", {
    count: inh.count,
    levelOrdinal,
  });
}

export async function buildLocationInhabitants(params: {
  scale: LocationScale;
  locationLevel: number;
  inhabitantType: InhabitantType;
  animateRolls?: boolean;
}): Promise<{
  inhabitants: ScavengerLocationInhabitants | null;
  rollLogs: ScavengerLocationRollLog[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const rollLogs: ScavengerLocationRollLog[] = [];

  if (!canHaveInhabitants(params.scale) || params.locationLevel < 1) {
    return { inhabitants: null, rollLogs, warnings };
  }

  const { count: baseCount, rollLog: countRoll } = await rollInhabitantCount(
    params.scale,
    { animate: params.animateRolls },
  );
  rollLogs.push(countRoll);

  if (params.inhabitantType === "overseerOverride") {
    return {
      inhabitants: {
        type: "overseerOverride",
        count: baseCount,
        baseCount,
        roster: [],
      },
      rollLogs,
      warnings,
    };
  }

  const allDenizens = await loadDenizens();
  if (!allDenizens.length) {
    warnings.push("No denizen data loaded (check src/data/denizens/)");
    return {
      inhabitants: {
        type: params.inhabitantType,
        count: baseCount,
        baseCount,
        roster: [],
      },
      rollLogs,
      warnings,
    };
  }

  const byType = filterDenizensByType(allDenizens, params.inhabitantType);
  let pool = filterDenizensByLevelBand(byType, params.locationLevel);

  if (!pool.length && byType.length) {
    const min = Math.max(1, params.locationLevel - 2);
    const max = params.locationLevel;
    warnings.push(
      `No ${params.inhabitantType} denizens at level ${min}–${max}; using full ${params.inhabitantType} catalog`,
    );
    pool = byType;
  }

  if (!pool.length) {
    warnings.push(
      `No denizens for ${params.inhabitantType} at level ${Math.max(1, params.locationLevel - 2)}–${params.locationLevel}`,
    );
    return {
      inhabitants: {
        type: params.inhabitantType,
        count: baseCount,
        baseCount,
        roster: [],
      },
      rollLogs,
      warnings,
    };
  }

  let draft = sampleDenizens(pool, baseCount);
  const sizeFlag = homogeneousNpcSize(draft);
  const adjusted = applyNpcSizeToCount(baseCount, sizeFlag);
  if (adjusted.modifierNote) {
    rollLogs.push({
      id: "inhabitant-count-mod",
      label: "Inhabitant count (Big/Little)",
      total: adjusted.count,
      detail: adjusted.modifierNote,
    });
  }

  if (adjusted.count > draft.length) {
    draft = [...draft, ...sampleDenizens(pool, adjusted.count - draft.length)];
  } else if (adjusted.count < draft.length) {
    draft = draft.slice(0, adjusted.count);
  }

  const roster = await Promise.all(draft.map((d) => toRosterEntry(d)));

  return {
    inhabitants: {
      type: params.inhabitantType,
      count: adjusted.count,
      baseCount,
      roster,
    },
    rollLogs,
    warnings,
  };
}

export const INHABITANT_TYPE_OPTIONS: InhabitantType[] = [
  "animals",
  "feralGhouls",
  "raiders",
  "superMutants",
  "robots",
  "overseerOverride",
];
