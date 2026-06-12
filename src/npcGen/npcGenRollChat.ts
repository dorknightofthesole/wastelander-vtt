import { t } from "../integrations/i18n.js";
import { evaluateFoundryRoll } from "../integrations/foundryRoll.js";
import { rollD20 } from "../scavenging/dice.js";
import { presentScavengerRoll } from "../scavenging/scavengerRollChat.js";

function extractD20Face(roll: Roll): number {
  for (const die of roll.dice ?? []) {
    for (const result of die.results ?? []) {
      if (result.active !== false) return result.result;
    }
  }
  for (const term of roll.terms ?? []) {
    if (
      typeof term === "object" &&
      term !== null &&
      "results" in term &&
      Array.isArray((term as { results: Array<{ result: number; active?: boolean }> }).results)
    ) {
      for (const result of (term as { results: Array<{ result: number; active?: boolean }> })
        .results) {
        if (result.active !== false) return result.result;
      }
    }
  }
  return 0;
}

/** Roll 1d20 via Foundry, animate dice, and post a chat card with the result. */
export async function rollNpcGenD20(params: {
  labelKey: string;
  buildDetail: (face: number) => {
    detailKey: string;
    detailData?: Record<string, string | number>;
  };
}): Promise<number> {
  const formula = "1d20";
  let face = 0;
  let roll: Roll | undefined;

  try {
    roll = await evaluateFoundryRoll(formula, { animate: false });
    face = extractD20Face(roll);
  } catch {
    face = rollD20(1).faces[0] ?? 1;
  }

  if (!face) face = rollD20(1).faces[0] ?? 1;

  const { detailKey, detailData } = params.buildDetail(face);

  if (roll) {
    await presentScavengerRoll({
      roll,
      formula,
      label: t(params.labelKey),
      total: face,
      detail: t(detailKey, { face, ...detailData }),
    });
  }

  return face;
}
