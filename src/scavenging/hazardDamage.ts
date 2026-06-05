import { applyActorHealthDamage } from "../integrations/applyActorHealthDamage.js";
import { t } from "../integrations/i18n.js";
import { presentScavengerRoll } from "./scavengerRollChat.js";
import { rollCombatDice } from "./dice.js";
import type { PartyActorRow, ScavengerLocation } from "./ScavengerLocation.js";
import { SEARCH_TIME_BY_SCALE } from "./locationRules.js";
import { getPartyActorsOnScene } from "./partyContext.js";
import {
  getHazardOngoingTick,
  normalizeHazardKind,
  problemsForProblemUi,
} from "./problemRules.js";

type FalloutCombatDieResult = {
  result: number;
  effect?: number;
  face?: number;
};

type FalloutRoller = {
  rollD6: (options: {
    actor?: string | null;
    dicenum?: number;
    rollname?: string;
    weapon?: null;
  }) => Promise<FalloutCombatDieResult[]>;
  showDiceSoNice?: (roll: Roll) => Promise<void>;
};

function sumFalloutCombatDiceDamage(dices: FalloutCombatDieResult[]): number {
  return dices.reduce((sum, die) => sum + (Number(die.result) || 0), 0);
}

async function notifyHazardDamageApplied(
  actor: Actor,
  damage: number,
  applied: { before: number; after: number } | null,
): Promise<void> {
  if (damage <= 0) {
    ui.notifications.info(t("WASTELANDER.Scavenging.HazardDamage.NoDamage"));
    return;
  }
  if (!applied) {
    ui.notifications.warn(
      t("WASTELANDER.Scavenging.HazardDamage.HealthNotApplied", {
        actor: actor.name,
      }),
    );
    return;
  }
  ui.notifications.info(
    t("WASTELANDER.Scavenging.HazardDamage.Applied", {
      actor: actor.name,
      damage,
      before: applied.before,
      after: applied.after,
    }),
  );
}

export type HazardDamagePlayerRow = {
  actorId: string;
  actorName: string;
  userName: string;
};

export type HazardDamageUi = {
  show: boolean;
  cdCount: number;
  formulaHint: string;
  searchMinutes: number;
  searchTimeLabel: string;
  players: HazardDamagePlayerRow[];
  partyEmpty: boolean;
};

/** Ongoing hazard: 1 CD per 10 min in location, or 1 CD per min at level 11+. */
export function getOngoingHazardCombatDiceCount(
  problems: ScavengerLocation["problems"],
  locationLevel: number,
  searchMinutes: number,
): number {
  if (!problems.hazard) return 0;
  if (normalizeHazardKind(problems, locationLevel) !== "ongoing") return 0;

  const minutes = Math.max(0, Math.floor(searchMinutes));
  if (minutes <= 0) return 0;

  const tick = problems.hazardOngoingTick ?? getHazardOngoingTick(locationLevel);
  if (tick === "perMin") return Math.max(1, minutes);
  const intervals = Math.floor(minutes / 10);
  return Math.max(1, intervals);
}

function resolveHazardDamageParty(
  location: ScavengerLocation,
  sceneId: string | null,
  partyRows?: PartyActorRow[],
): HazardDamagePlayerRow[] {
  const onScene = getPartyActorsOnScene(sceneId ?? location.sceneId);
  if (onScene.length > 0) {
    return onScene.map((row) => ({
      actorId: row.actorId,
      actorName: row.actorName,
      userName: row.userName,
    }));
  }

  const fromUi = (partyRows ?? []).filter((row) => row.selected);
  if (fromUi.length > 0) {
    return fromUi.map((row) => ({
      actorId: row.actorId,
      actorName: row.actorName,
      userName: row.userName,
    }));
  }

  const rows: HazardDamagePlayerRow[] = [];
  for (const actorId of location.partyActorIds ?? []) {
    const actor = game.actors.get(actorId);
    if (!actor) continue;
    rows.push({
      actorId,
      actorName: actor.name,
      userName: t("WASTELANDER.Scavenging.HazardDamage.PartyFromLocation"),
    });
  }
  return rows;
}

export function buildHazardDamageUi(
  location: ScavengerLocation,
  sceneId: string | null,
  formProblems?: ScavengerLocation["problems"],
  partyRows?: PartyActorRow[],
): HazardDamageUi {
  const empty: HazardDamageUi = {
    show: false,
    cdCount: 0,
    formulaHint: "",
    searchMinutes: 0,
    searchTimeLabel: "",
    players: [],
    partyEmpty: true,
  };

  const display = problemsForProblemUi(
    formProblems ?? location.problems,
    location,
  );
  const cdCount = getOngoingHazardCombatDiceCount(
    display.problems,
    display.level,
    location.searchMinutes,
  );
  if (cdCount <= 0) return empty;

  const tick = display.problems.hazardOngoingTick ?? getHazardOngoingTick(display.level);
  const formulaHint =
    tick === "perMin"
      ? t("WASTELANDER.Scavenging.HazardDamage.FormulaPerMin", {
          count: cdCount,
          searchMinutes: location.searchMinutes,
        })
      : t("WASTELANDER.Scavenging.HazardDamage.FormulaPer10Min", {
          count: cdCount,
          searchMinutes: location.searchMinutes,
        });

  const players = resolveHazardDamageParty(location, sceneId, partyRows);
  return {
    show: true,
    cdCount,
    formulaHint,
    searchMinutes: location.searchMinutes,
    searchTimeLabel: t("WASTELANDER.Scavenging.HazardDamage.SearchTime", {
      minutes: location.searchMinutes,
      scaleLabel: SEARCH_TIME_BY_SCALE[location.scale].label,
    }),
    players,
    partyEmpty: players.length === 0,
  };
}

function resolveActorUuidForHazardRoll(
  actorId: string,
  sceneId: string | null,
): string {
  const targetSceneId = sceneId ?? null;
  if (targetSceneId) {
    const scene = (game as { scenes?: { get: (id: string) => SceneTokens | undefined } })
      .scenes?.get(targetSceneId);
    const tokens = scene?.tokens;
    if (tokens) {
      const list = Array.isArray(tokens)
        ? tokens
        : Object.values(tokens as Record<string, SceneTokenDoc>);
      const linked = list.find((tok) => tok.actorLink && tok.actorId === actorId);
      if (linked?.uuid) return linked.uuid;
    }
  }

  const canvasScene = canvas?.scene;
  if (canvasScene?.id === targetSceneId && canvas.tokens?.placeables) {
    for (const token of canvas.tokens.placeables as Array<{
      document: { actorId: string | null; actorLink: boolean; uuid?: string };
    }>) {
      if (token.document.actorLink && token.document.actorId === actorId) {
        return token.document.uuid ?? `Actor.${actorId}`;
      }
    }
  }

  const actor = game.actors.get(actorId);
  return actor?.uuid ?? `Actor.${actorId}`;
}

type SceneTokenDoc = { actorId: string | null; actorLink: boolean; uuid?: string };
type SceneTokens = {
  tokens?: SceneTokenDoc[] | Record<string, SceneTokenDoc>;
};

export async function rollHazardDamageForActor(params: {
  actorId: string;
  sceneId: string | null;
  location: ScavengerLocation;
  formProblems?: ScavengerLocation["problems"];
}): Promise<void> {
  const display = problemsForProblemUi(
    params.formProblems ?? params.location.problems,
    params.location,
  );
  const cdCount = getOngoingHazardCombatDiceCount(
    display.problems,
    display.level,
    params.location.searchMinutes,
  );
  if (cdCount <= 0) {
    ui.notifications.warn(t("WASTELANDER.Scavenging.HazardDamage.NotOngoing"));
    return;
  }

  const actor = game.actors.get(params.actorId);
  if (!actor) {
    ui.notifications.error(t("WASTELANDER.Scavenging.HazardDamage.ActorMissing"));
    return;
  }

  const rollName = t("WASTELANDER.Scavenging.HazardDamage.RollName", {
    location: params.location.name,
    actor: actor.name,
  });
  const detail = t("WASTELANDER.Scavenging.HazardDamage.RollDetail", {
    count: cdCount,
    minutes: params.location.searchMinutes,
  });
  const actorRef = resolveActorUuidForHazardRoll(params.actorId, params.sceneId);

  const fallout = (globalThis as { fallout?: { Roller2D20?: FalloutRoller } }).fallout;
  if (fallout?.Roller2D20?.rollD6) {
    const dicesRolled = await fallout.Roller2D20.rollD6({
      actor: actorRef,
      dicenum: cdCount,
      rollname: rollName,
      weapon: null,
    });
    const damage = sumFalloutCombatDiceDamage(
      Array.isArray(dicesRolled) ? dicesRolled : [],
    );
    const applied = await applyActorHealthDamage(params.actorId, damage);
    await notifyHazardDamageApplied(actor, damage, applied);
    return;
  }

  const result = await rollCombatDice(cdCount, { animate: true });
  if (!result.roll) {
    ui.notifications.error(t("WASTELANDER.Scavenging.HazardDamage.RollFailed"));
    return;
  }
  await presentScavengerRoll({
    roll: result.roll,
    formula: result.formula,
    label: rollName,
    total: result.sum,
    detail,
    animate: true,
  });
  const applied = await applyActorHealthDamage(params.actorId, result.sum);
  await notifyHazardDamageApplied(actor, result.sum, applied);
}
