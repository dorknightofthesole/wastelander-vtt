import type { CharacterNpcBuildResult } from "./buildCharacterNpcStats.js";
import {
  buildNpcGenFieldRows,
  buildNpcGenTraitsTableHtml,
} from "./npcGenActorData.js";
import { npcFullName, type NpcGeneratorState } from "./npcGeneratorState.js";
import type { NpcGeneratorRolls } from "./npcGeneratorState.js";

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderNpcJournalHtml(
  state: NpcGeneratorState,
  stats: CharacterNpcBuildResult | null,
  actorId?: string,
): string {
  const name = npcFullName(state.rolls) || "Unnamed NPC";
  const tableHtml = buildNpcGenTraitsTableHtml(
    buildNpcGenFieldRows(state, stats),
    "npc-gen-table",
  );

  const actorLink = actorId
    ? `<p><a class="content-link" data-link data-uuid="Actor.${actorId}" data-id="${actorId}" data-type="Actor" data-tooltip="Actor">${escapeHtml(name)}</a></p>`
    : "";

  return `<div class="wastelander-npc-gen-journal">
${actorLink}
${tableHtml}
</div>`;
}

/** Biography editor starts empty; rolled traits live on the Data tab panel. */
export function renderNpcBiographyHtml(
  _state: NpcGeneratorState,
  _stats: CharacterNpcBuildResult,
): string {
  return "";
}

/** @deprecated Prefer full {@link NpcGeneratorState} via renderNpcJournalHtml. */
export function renderNpcBiographyHtmlFromRolls(
  rolls: NpcGeneratorRolls,
  stats: CharacterNpcBuildResult,
): string {
  return renderNpcJournalHtml(
    {
      step: "review",
      rolls,
      meta: {},
      review: { level: stats.level, npcType: stats.npcType },
      gear: { denizenCombatItems: [], previewDenizenId: null },
    },
    stats,
  );
}
