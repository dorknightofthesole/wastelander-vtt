import { MODULE_ID } from "../constants.js";
import { t } from "../integrations/i18n.js";
import { currentUserIsOverseer, isOverseer } from "../integrations/overseerAccess.js";
import type { CharacterNpcBuildResult } from "./buildCharacterNpcStats.js";
import { NPC_GENERATOR_SETTINGS } from "./npcGeneratorSettings.js";
import { renderNpcJournalHtml } from "./renderNpcJournalHtml.js";
import { npcFullName, type NpcGeneratorState } from "./npcGeneratorState.js";

const PAGE_ACTOR_FLAG = "actorId";
const ACTOR_PAGE_FLAG = "npcJournalPageId";

function overseerOwnership(): Record<string, number> {
  const ownership: Record<string, number> = { default: 0 };
  const users = (game as { users?: { contents?: Array<{ id: string; isGM: boolean; role?: number }> } })
    .users?.contents;
  for (const user of users ?? []) {
    if (isOverseer(user)) ownership[user.id] = 3;
  }
  return ownership;
}

function journalTextPagePayload(name: string, html: string): {
  name: string;
  type: string;
  text: { content: string; format: number };
} {
  const format =
    (globalThis as { CONST?: { JOURNAL_ENTRY_PAGE_FORMATS?: { HTML: number } } })
      .CONST?.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1;
  return {
    name,
    type: "text",
    text: { content: html, format },
  };
}

async function getNpcGeneratorJournalId(): Promise<string> {
  const settings = game.settings as {
    get: (scope: string, key: string) => unknown;
    set: (scope: string, key: string, value: unknown) => Promise<unknown>;
  };
  let journalId = String(
    settings.get(MODULE_ID, NPC_GENERATOR_SETTINGS.npcGeneratorJournalId) ?? "",
  ).trim();

  const journalCol = game.journal;
  if (journalId && journalCol?.get(journalId)) return journalId;

  const journalTitle = t("WASTELANDER.NpcGen.Journal.Title");
  const existing = journalCol?.find?.((entry) => entry.name === journalTitle);
  if (existing?.id) {
    journalId = existing.id;
  } else {
    const created = await JournalEntry.create({
      name: journalTitle,
      folder: null,
      ownership: overseerOwnership(),
    });
    journalId = created.id;
  }

  await settings.set(
    MODULE_ID,
    NPC_GENERATOR_SETTINGS.npcGeneratorJournalId,
    journalId,
  );
  return journalId;
}

function findPageForActor(
  journal: JournalEntry,
  actorId: string,
): JournalEntryPage | undefined {
  const actor = game.actors.get(actorId);
  const pageId = actor?.getFlag(MODULE_ID, ACTOR_PAGE_FLAG) as string | undefined;
  if (pageId) {
    const byId = journal.pages.get(pageId);
    if (byId) return byId;
  }
  return journal.pages.find(
    (page) => page.getFlag(MODULE_ID, PAGE_ACTOR_FLAG) === actorId,
  );
}

export async function syncNpcJournalPage(
  actor: Actor,
  state: NpcGeneratorState,
  stats: CharacterNpcBuildResult,
): Promise<void> {
  if (!currentUserIsOverseer()) return;

  const journalId = await getNpcGeneratorJournalId();
  const journal = game.journal.get(journalId);
  if (!journal) throw new Error("NPC generator journal not found.");

  const title = npcFullName(state.rolls) || actor.name;
  const html = renderNpcJournalHtml(state, stats, actor.id);
  const payload = journalTextPagePayload(title, html);

  const existing = findPageForActor(journal, actor.id);
  if (existing) {
    await existing.update({
      name: title,
      text: payload.text,
    });
    await existing.setFlag(MODULE_ID, PAGE_ACTOR_FLAG, actor.id);
    await actor.setFlag(MODULE_ID, ACTOR_PAGE_FLAG, existing.id);
    return;
  }

  const [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [
    {
      ...payload,
      flags: { [MODULE_ID]: { [PAGE_ACTOR_FLAG]: actor.id } },
    },
  ]);
  if (page) {
    await actor.setFlag(MODULE_ID, ACTOR_PAGE_FLAG, page.id);
  }
}
