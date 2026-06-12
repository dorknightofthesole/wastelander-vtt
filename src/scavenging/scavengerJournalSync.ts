import { MODULE_ID } from "../constants.js";
import { t } from "../integrations/i18n.js";
import { currentUserIsOverseer, isOverseer } from "../integrations/overseerAccess.js";
import { renderScavengerJournalHtml } from "./renderScavengerJournalHtml.js";
import { getPartyActorsOnScene } from "./partyContext.js";
import {
  loadPlayerSearchForScene,
  loadScavengerSceneState,
  getSceneDocument,
  mergePartySelections,
} from "./scenePersist.js";
import { SCAVENGING_SETTINGS } from "./scavengingSettings.js";

const LOCATION_FLAG = "scavengerLocation";
const PAGE_SCENE_FLAG = "sceneId";
const SCENE_PAGE_FLAG = "scavengerJournalPageId";

const syncTimers = new Map<string, ReturnType<typeof setTimeout>>();
let syncInFlight = false;

function overseerOwnership(): Record<string, number> {
  const ownership: Record<string, number> = { default: 0 };
  const users = (game as { users?: { contents?: Array<{ id: string; isGM: boolean; role?: number }> } })
    .users?.contents;
  for (const user of users ?? []) {
    if (isOverseer(user)) ownership[user.id] = 3;
  }
  return ownership;
}

function getJournalCollection(): {
  get: (id: string) => JournalDoc | undefined;
  find?: (predicate: (entry: JournalDoc) => boolean) => JournalDoc | undefined;
} | undefined {
  return (game as {
    journal?: {
      get: (id: string) => JournalDoc;
      find: (predicate: (entry: JournalDoc) => boolean) => JournalDoc | undefined;
    };
  }).journal;
}

type JournalDoc = {
  id: string;
  name: string;
  pages: JournalPageCollection;
  createEmbeddedDocuments: (
    embeddedName: string,
    data: object[],
  ) => Promise<JournalPageDoc[]>;
};

type JournalPageCollection = {
  get: (id: string) => JournalPageDoc | undefined;
  find?: (fn: (page: JournalPageDoc) => boolean) => JournalPageDoc | undefined;
  contents?: JournalPageDoc[];
};

type JournalPageDoc = {
  id: string;
  name: string;
  getFlag: (scope: string, key: string) => unknown;
  update: (data: object) => Promise<unknown>;
  setFlag: (scope: string, key: string, value: unknown) => Promise<unknown>;
};

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

async function getScavengerJournalId(): Promise<string> {
  const settings = game.settings as {
    get: (scope: string, key: string) => unknown;
    set: (scope: string, key: string, value: unknown) => Promise<unknown>;
  };
  let journalId = String(
    settings.get(MODULE_ID, SCAVENGING_SETTINGS.scavengerJournalId) ?? "",
  ).trim();

  const journalCol = getJournalCollection();
  if (journalId && journalCol?.get(journalId)) return journalId;

  const JournalEntry = (globalThis as { JournalEntry?: { create: (d: object) => Promise<{ id: string }> } })
    .JournalEntry;
  if (!JournalEntry?.create) {
    throw new Error("Journal documents are not available.");
  }

  const journalTitle = t("WASTELANDER.Scavenging.Journal.Title");
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

  await settings.set(MODULE_ID, SCAVENGING_SETTINGS.scavengerJournalId, journalId);
  return journalId;
}

function findPageForScene(journal: JournalDoc, sceneId: string): JournalPageDoc | undefined {
  const scene = getSceneDocument(sceneId);
  const pageId = scene?.getFlag?.(MODULE_ID, SCENE_PAGE_FLAG) as string | undefined;
  if (pageId) {
    const byId = journal.pages.get(pageId);
    if (byId) return byId;
  }

  const pages = journal.pages.contents ?? [];
  return pages.find((page) => page.getFlag(MODULE_ID, PAGE_SCENE_FLAG) === sceneId);
}

async function syncScavengerJournalForSceneInner(sceneId: string): Promise<void> {
  const scene = getSceneDocument(sceneId);
  if (!scene) return;

  const sceneName = scene.name?.trim() || t("WASTELANDER.Scavenging.Journal.UnnamedScene");
  const state = loadScavengerSceneState(sceneId);
  const location = state?.location ?? null;
  const playerSearch = loadPlayerSearchForScene(sceneId);
  const party = mergePartySelections(
    getPartyActorsOnScene(sceneId),
    state?.partySelections,
  );
  const formProblems = state?.form.problems ?? {
    obstacle: false,
    hazard: false,
    inhabitants: true,
  };
  const html = await renderScavengerJournalHtml({
    sceneId,
    sceneName,
    location,
    formProblems,
    party,
    playerSearch,
  });

  const journalId = await getScavengerJournalId();
  const journalCol = getJournalCollection();
  const journal = journalCol?.get(journalId);
  if (!journal?.createEmbeddedDocuments) {
    throw new Error("Scavenger journal not found.");
  }

  const pagePayload = journalTextPagePayload(sceneName, html);
  let page = findPageForScene(journal, sceneId);

  if (page) {
    await page.update(pagePayload);
  } else {
    const created = await journal.createEmbeddedDocuments("JournalEntryPage", [
      pagePayload,
    ]);
    page = created[0];
    if (!page) throw new Error("Could not create scavenger journal page.");
    await page.setFlag(MODULE_ID, PAGE_SCENE_FLAG, sceneId);
    if (scene.setFlag) {
      await scene.setFlag(MODULE_ID, SCENE_PAGE_FLAG, page.id);
    }
  }

  if (location) {
    await page.setFlag(MODULE_ID, LOCATION_FLAG, location);
  }
}

/** Debounced journal refresh for a scene (GM world only). */
export function scheduleScavengerJournalSync(sceneId: string): void {
  if (!currentUserIsOverseer()) return;
  const id = sceneId.trim();
  if (!id) return;

  const existing = syncTimers.get(id);
  if (existing) clearTimeout(existing);
  syncTimers.set(
    id,
    setTimeout(() => {
      syncTimers.delete(id);
      void flushScavengerJournalSync(id);
    }, 400),
  );
}

export async function flushScavengerJournalSync(sceneId: string): Promise<void> {
  if (!currentUserIsOverseer()) return;
  if (syncInFlight) {
    scheduleScavengerJournalSync(sceneId);
    return;
  }
  syncInFlight = true;
  try {
    await syncScavengerJournalForSceneInner(sceneId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`${MODULE_ID} | scavenger journal sync failed`, error);
    ui.notifications.warn(
      t("WASTELANDER.Scavenging.Notify.JournalSyncError", { error: message }),
    );
  } finally {
    syncInFlight = false;
  }
}
