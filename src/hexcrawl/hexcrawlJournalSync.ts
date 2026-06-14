import { MODULE_ID } from "../constants.js";
import { t } from "../integrations/i18n.js";
import { currentUserIsOverseer, isOverseer } from "../integrations/overseerAccess.js";
import { getSceneDocument } from "../scavenging/scenePersist.js";
import { HEXCRAWL_JOURNAL_PAGE_FLAG, loadHexcrawlSceneState } from "./hexcrawlScenePersist.js";
import { HEXCRAWL_SETTINGS } from "./hexcrawlSettings.js";
import { renderHexcrawlJournalHtml } from "./renderHexcrawlJournalHtml.js";

const PAGE_SCENE_FLAG = "sceneId";

const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
let syncInFlight = false;

/** Foundry OBSERVER — players can read the travel journal. */
const JOURNAL_OBSERVER_LEVEL = 2;
const JOURNAL_OWNER_LEVEL = 3;

function travelJournalOwnership(): Record<string, number> {
  const ownership: Record<string, number> = { default: JOURNAL_OBSERVER_LEVEL };
  for (const user of game.users.contents ?? []) {
    if (isOverseer(user)) ownership[user.id] = JOURNAL_OWNER_LEVEL;
  }
  return ownership;
}

async function ensureTravelJournalOwnership(journal: JournalEntry): Promise<void> {
  const desired = travelJournalOwnership();
  const currentDefault = Number(journal.ownership?.default ?? 0);
  if (currentDefault >= JOURNAL_OBSERVER_LEVEL) return;
  await journal.update({ ownership: desired });
}

function journalTextPagePayload(name: string, html: string): {
  name: string;
  type: string;
  text: { content: string; format: number };
} {
  const format =
    CONST.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ??
    (globalThis as { CONST?: { JOURNAL_ENTRY_PAGE_FORMATS?: { HTML: number } } })
      .CONST?.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ??
    1;
  return {
    name,
    type: "text",
    text: { content: html, format },
  };
}

async function getWastelandTravelsJournalId(): Promise<string> {
  let journalId = String(
    game.settings.get(MODULE_ID, HEXCRAWL_SETTINGS.wastelandTravelsJournalId) ?? "",
  ).trim();

  if (journalId && game.journal.get(journalId)) {
    const journal = game.journal.get(journalId);
    if (journal) await ensureTravelJournalOwnership(journal);
    return journalId;
  }

  const journalTitle = t("WASTELANDER.Hexcrawl.Journal.Title");
  const existing = game.journal.find((entry) => entry.name === journalTitle);
  if (existing?.id) {
    journalId = existing.id;
    await ensureTravelJournalOwnership(existing);
  } else {
    const created = await JournalEntry.create({
      name: journalTitle,
      folder: null,
      ownership: travelJournalOwnership(),
    });
    journalId = created.id;
  }

  await game.settings.set(
    MODULE_ID,
    HEXCRAWL_SETTINGS.wastelandTravelsJournalId,
    journalId,
  );
  return journalId;
}

function findPageForScene(journal: JournalEntry, sceneId: string): JournalEntryPage | undefined {
  const scene = getSceneDocument(sceneId);
  const pageId = scene?.getFlag?.(MODULE_ID, HEXCRAWL_JOURNAL_PAGE_FLAG) as
    | string
    | undefined;
  if (pageId) {
    const byId = journal.pages.get(pageId);
    if (byId) return byId;
  }
  return journal.pages.find(
    (page) => page.getFlag(MODULE_ID, PAGE_SCENE_FLAG) === sceneId,
  );
}

async function syncHexcrawlJournalForSceneInner(sceneId: string): Promise<void> {
  const scene = getSceneDocument(sceneId);
  const state = loadHexcrawlSceneState(sceneId);
  if (!scene || !state) return;

  const sceneName = scene.name?.trim() || t("WASTELANDER.Hexcrawl.Journal.UnnamedScene");
  const html = renderHexcrawlJournalHtml({ state });
  const journalId = await getWastelandTravelsJournalId();
  const journal = game.journal.get(journalId);
  if (!journal) throw new Error("Wasteland Travels journal not found.");

  const pagePayload = journalTextPagePayload(sceneName, html);
  let page = findPageForScene(journal, sceneId);

  if (page) {
    await page.update(pagePayload);
  } else {
    const created = await journal.createEmbeddedDocuments("JournalEntryPage", [
      pagePayload,
    ]);
    page = created[0];
    if (!page) throw new Error("Could not create hexcrawl journal page.");
    await page.setFlag(MODULE_ID, PAGE_SCENE_FLAG, sceneId);
    if (scene.setFlag) {
      await scene.setFlag(MODULE_ID, HEXCRAWL_JOURNAL_PAGE_FLAG, page.id);
    }
  }
}

export function scheduleHexcrawlJournalSync(sceneId: string): void {
  if (!currentUserIsOverseer()) return;
  const id = sceneId.trim();
  if (!id) return;

  const existing = syncTimers.get(id);
  if (existing) clearTimeout(existing);
  syncTimers.set(
    id,
    setTimeout(() => {
      syncTimers.delete(id);
      void flushHexcrawlJournalSync(id);
    }, 400),
  );
}

export async function flushHexcrawlJournalSync(sceneId: string): Promise<void> {
  if (!currentUserIsOverseer()) return;
  if (syncInFlight) {
    scheduleHexcrawlJournalSync(sceneId);
    return;
  }
  syncInFlight = true;
  try {
    await syncHexcrawlJournalForSceneInner(sceneId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`${MODULE_ID} | hexcrawl journal sync failed`, error);
    ui.notifications.warn(
      t("WASTELANDER.Hexcrawl.Notify.JournalSyncError", { error: message }),
    );
  } finally {
    syncInFlight = false;
  }
}

export async function openHexcrawlJournalPage(sceneId: string): Promise<void> {
  if (currentUserIsOverseer()) {
    await flushHexcrawlJournalSync(sceneId);
  }
  const journalId = await getWastelandTravelsJournalId();
  const journal = game.journal.get(journalId);
  if (!journal) return;
  const page = findPageForScene(journal, sceneId);
  if (!page) return;
  page.sheet?.render(true);
}
