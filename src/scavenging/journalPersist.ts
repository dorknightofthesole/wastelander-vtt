import { MODULE_ID } from "../constants.js";
import { t } from "../integrations/i18n.js";
import type { ScavengerLocation } from "./ScavengerLocation.js";
import {
  formatHazardSummary,
  formatObstacleSummary,
  normalizeHazardKind,
  resolveLocationProblems,
} from "./problemRules.js";

const FLAG_KEY = "scavengerLocation";

export function locationFromJournalPage(page: {
  getFlag: (scope: string, key: string) => unknown;
}): ScavengerLocation | null {
  const raw = page.getFlag(MODULE_ID, FLAG_KEY);
  if (!raw || typeof raw !== "object") return null;
  return raw as ScavengerLocation;
}

function formatItemsList(location: ScavengerLocation): string {
  return location.items
    .map((i) => `${i.category}: ${i.min}–${i.max} rolls`)
    .join("<br>");
}

function formatOtherFoundList(location: ScavengerLocation): string {
  const rolls = location.otherFoundRolls ?? [];
  if (!rolls.length) return "";
  const lines = rolls
    .map((r) => `d20 ${r.d20} → ${r.category}`)
    .join("<br>");
  return `<p><strong>Other found (d20):</strong><br>${lines}</p>`;
}

function problemSummaryLabels(): Parameters<typeof formatObstacleSummary>[1] {
  return {
    obstacleTypeLabel: "",
    obstacleSkillLabel: "",
    hazardKindLabel: "",
    obstacleOvercomeNote: ` (${t("WASTELANDER.Scavenging.Problems.ObstacleOvercome")})`,
    obstacleNotOvercomeNote: ` (${t("WASTELANDER.Scavenging.Problems.ObstacleNotOvercome")})`,
  };
}

function formatProblems(location: ScavengerLocation): string {
  const p = location.problems;
  const parts: string[] = [];
  if (p.obstacle) {
    const type = p.obstacleType ?? "mechanical";
    const base = problemSummaryLabels();
    parts.push(
      formatObstacleSummary(p, {
        ...base,
        obstacleTypeLabel: t(`WASTELANDER.Scavenging.Problems.ObstacleTypes.${type}`),
        obstacleSkillLabel: t(
          `WASTELANDER.Scavenging.Problems.ObstacleSkills.${type}`,
        ),
      }),
    );
  }
  if (p.hazard) {
    const kind = normalizeHazardKind(p, location.level);
    parts.push(
      `${t(`WASTELANDER.Scavenging.Problems.HazardKinds.${kind}`)}: ${formatHazardSummary(p, location.level)}`,
    );
  }
  if (p.inhabitants || location.inhabitants) {
    const inh = location.inhabitants;
    if (inh) {
      const typeLabel = inh.type.replace(/([A-Z])/g, " $1").trim();
      const countNote =
        inh.baseCount !== inh.count
          ? ` (${inh.count} after Big/Little; rolled ${inh.baseCount} on scale dice)`
          : "";
      parts.push(
        `Inhabitants (${typeLabel}): ${inh.count} at location level ${p.inhabitantLevel ?? location.level}${countNote}`,
      );
      if (inh.roster.length) {
        parts.push(
          inh.roster
            .map((r) => {
              const meta = `Lv ${r.level}${r.npcSize ? `, ${r.npcSize}` : ""}`;
              if (r.foundryUuid) {
                return `· <a class="entity-link" data-uuid="${r.foundryUuid}">${r.name}</a> (${meta})`;
              }
              return `· ${r.name} (${meta})`;
            })
            .join("<br>"),
        );
      }
    } else {
      parts.push(
        `Inhabitants: ${p.inhabitantCount ?? "?"} at level ${p.inhabitantLevel ?? location.level}`,
      );
    }
  }
  return parts.length ? parts.join("<br>") : "None";
}

export function renderLocationHtml(location: ScavengerLocation): string {
  const rolls = location.rollLog
    .map(
      (r) =>
        `<li><strong>${r.label}</strong>${r.formula ? ` (${r.formula})` : ""}: ${r.total ?? "—"}${r.detail ? ` — ${r.detail}` : ""}</li>`,
    )
    .join("");

  const loot = (location.lootResults ?? [])
    .map((l) => `<li>${l.category}: ${l.label}</li>`)
    .join("");

  return `
<section class="wastelander-scavenger-journal">
  <h2>${location.name}</h2>
  ${location.concept ? `<p><em>${location.concept}</em></p>` : ""}
  <h3>Mechanics</h3>
  <p><strong>Scale:</strong> ${location.scale} · <strong>Category:</strong> ${location.categoryId} · <strong>Degree:</strong> ${location.degree}</p>
  <p><strong>Level:</strong> ${location.level} · <strong>Search:</strong> PER+Survival diff ${location.searchDifficulty}, ${location.searchMinutes} min</p>
  <p><strong>Item categories:</strong><br>${formatItemsList(location)}</p>
  ${formatOtherFoundList(location)}
  <p><strong>Problems:</strong><br>${formatProblems(location)}</p>
  ${rolls ? `<h3>Creation rolls</h3><ul>${rolls}</ul>` : ""}
  ${loot ? `<h3>Loot (simulated)</h3><ul>${loot}</ul>` : ""}
</section>`;
}

export async function saveLocationToJournal(
  location: ScavengerLocation,
  options?: { journalId?: string },
): Promise<ScavengerLocation> {
  const normalized: ScavengerLocation = {
    ...location,
    problems: resolveLocationProblems(location.problems, location.level),
  };
  const html = renderLocationHtml(normalized);
  const JournalEntry = (globalThis as { JournalEntry?: JournalEntryClass })
    .JournalEntry;
  const JournalEntryPage = (globalThis as { JournalEntryPage?: JournalEntryPageClass })
    .JournalEntryPage;
  if (!JournalEntry?.create || !JournalEntryPage?.create) {
    throw new Error("Journal documents are not available.");
  }

  let journalId = options?.journalId ?? normalized.journalId;
  if (!journalId) {
    const journal = await JournalEntry.create({
      name: `Scavenging: ${normalized.name}`,
      folder: null,
    });
    journalId = journal.id;
  }

  let pageId = normalized.journalPageId;
  if (pageId) {
    const page = (globalThis as { JournalEntryPage?: { get: (id: string) => { update: (d: object) => Promise<unknown> } } })
      .JournalEntryPage?.get(pageId);
    if (page) {
      await page.update({
        name: normalized.name,
        text: { content: html, format: 1 },
      });
      await page.setFlag(MODULE_ID, FLAG_KEY, normalized);
    }
  } else {
    const page = await JournalEntryPage.create({
      name: normalized.name,
      journal: journalId,
      text: { content: html, format: 1 },
    });
    pageId = page.id;
    await page.setFlag(MODULE_ID, FLAG_KEY, normalized);
  }

  return {
    ...normalized,
    journalId,
    journalPageId: pageId,
  };
}

type JournalEntryClass = {
  create: (data: object) => Promise<{ id: string }>;
};

type JournalEntryPageClass = {
  create: (data: object) => Promise<{
    id: string;
    setFlag: (scope: string, key: string, value: unknown) => Promise<unknown>;
  }>;
  get: (id: string) => {
    update: (data: object) => Promise<unknown>;
    setFlag: (scope: string, key: string, value: unknown) => Promise<unknown>;
  };
};
