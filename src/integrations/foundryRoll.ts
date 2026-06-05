/** Show physical / 3D dice for an already-evaluated roll. */
export async function showRollAnimation(roll: Roll): Promise<void> {
  const showDice = (
    globalThis as { fallout?: { Roller2D20?: { showDiceSoNice?: (r: Roll) => Promise<void> } } }
  ).fallout?.Roller2D20?.showDiceSoNice;
  if (showDice) {
    await showDice(roll);
    return;
  }

  const dice3d = (
    game as {
      dice3d?: {
        showForRoll?: (
          roll: Roll,
          user: User,
          sync?: boolean,
          options?: object,
        ) => Promise<boolean | void>;
      };
    }
  ).dice3d;
  if (dice3d?.showForRoll) {
    await dice3d.showForRoll(roll, game.user, true);
    return;
  }

  if (typeof roll.toMessage === "function") {
    await roll.toMessage({
      rollMode: game.settings.get("core", "rollMode"),
    });
  }
}

/** Use Foundry's global Roll (never a bundled copy) so system dice terms work. */
export function createFoundryRoll(formula: string): Roll {
  const RollCtor = (globalThis as { Roll?: typeof Roll }).Roll;
  if (!RollCtor) {
    throw new Error("Foundry Roll API is not available.");
  }
  return new RollCtor(formula);
}

export async function evaluateFoundryRoll(
  formula: string,
  options?: { animate?: boolean },
): Promise<Roll> {
  const normalized = formula.replace(/\s+/g, "").toLowerCase();
  const roll = createFoundryRoll(normalized);
  await roll.evaluate();
  if (options?.animate !== false) {
    await showRollAnimation(roll);
  }
  return roll;
}
