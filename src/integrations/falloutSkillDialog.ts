import type { FalloutActorSystemSlice } from "../export/actorDerivedStats.js";
import { getPerSurvivalTargetNumber } from "../scavenging/searchTeam.js";

type FalloutD20DieResult = {
  success?: number;
  result: number;
  complication?: number;
  reroll?: boolean;
};

type FalloutD20RollResult = {
  roll?: Roll;
  dicesRolled?: FalloutD20DieResult[];
};

type FalloutDialog2d20 = {
  createDialog: (options: {
    rollName?: string;
    diceNum?: number;
    attribute?: number;
    skill?: number;
    tag?: boolean;
    complication?: number;
    rollLocation?: boolean;
    actor?: string | Actor | null;
    item?: Item | null;
  }) => Promise<FalloutD20RollResult | null>;
};

export type FalloutSurvivalDialogResult = {
  faces: number[];
  successes: number;
  targetNumber: number;
  formula: string;
};

function falloutApi(): { Dialog2d20?: FalloutDialog2d20 } | undefined {
  return (globalThis as { fallout?: { Dialog2d20?: FalloutDialog2d20 } }).fallout;
}

/** Whether the Fallout system's 2d20 skill dialog is available. */
export function isFalloutSkillDialogAvailable(): boolean {
  return game.system.id === "fallout" && typeof falloutApi()?.Dialog2d20?.createDialog === "function";
}

function survivalSkillItem(actor: Actor): Item | undefined {
  return actor.items.find(
    (item) => item.type === "skill" && item.name.toLowerCase() === "survival",
  );
}

/**
 * Open the Fallout system's 2d20 dialog pre-filled for PER + Survival — same UI as
 * clicking Survival on the actor sheet. The player can pick 1–5 d20s (extra dice cost AP
 * per the rulebook; spend AP on the character sheet before or after rolling).
 */
export async function promptSurvivalSearchRoll(
  actor: Actor,
  options?: { diceNum?: number; rollName?: string },
): Promise<FalloutSurvivalDialogResult | null> {
  const createDialog = falloutApi()?.Dialog2d20?.createDialog;
  if (!createDialog) return null;

  const skillItem = survivalSkillItem(actor);
  const { per, survival, targetNumber } = getPerSurvivalTargetNumber(actor);
  const tag = Boolean((skillItem?.system as { tag?: boolean }).tag);
  const complication = Number(
    (actor.system as FalloutActorSystemSlice & { complication?: number }).complication ?? 20,
  );
  const skillLabel = skillItem?.name ?? "Survival";
  const rollName = options?.rollName ?? skillLabel;

  const actorRef = (actor as { uuid?: string }).uuid ?? actor;

  const result = await createDialog({
    rollName,
    diceNum: options?.diceNum ?? 2,
    attribute: per,
    skill: survival,
    tag,
    complication,
    actor: actorRef,
  });

  const dices = result?.dicesRolled;
  if (!dices?.length) return null;

  const faces = dices.map((die) => die.result);
  const successes = dices.reduce((sum, die) => sum + (Number(die.success) || 0), 0);

  return {
    faces,
    successes,
    targetNumber,
    formula: `${faces.length}d20`,
  };
}
