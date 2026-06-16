import type { HexcrawlSceneState, JourneyLogEntry } from "./hexcrawlScenePersist.js";
import { t } from "../integrations/i18n.js";
import { formatSearchDuration } from "../scavenging/searchWorldClock.js";
import { formatHours, formatMphWithUnit } from "./travelRules.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatSessionTimestamp(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatEntryTimeLabel(entry: JourneyLogEntry): string {
  if (entry.clockFrom && entry.clockTo && entry.clockFrom !== entry.clockTo) {
    return t("WASTELANDER.Hexcrawl.Journal.ClockRange", {
      from: entry.clockFrom,
      to: entry.clockTo,
    });
  }
  if (entry.clockTo) return entry.clockTo;
  if (entry.clockFrom) return entry.clockFrom;
  if (entry.clockAt) return entry.clockAt;
  if (entry.kind === "clockAdvanced" && entry.minutes) {
    return t("WASTELANDER.Hexcrawl.Journal.TravelDuration", {
      duration: formatSearchDuration(entry.minutes),
    });
  }
  return formatSessionTimestamp(entry.at);
}

function formatListItem(
  entry: JourneyLogEntry,
  message: string,
  suffixHtml = "",
): string {
  const when = escapeHtml(formatEntryTimeLabel(entry));
  const day = t("WASTELANDER.Hexcrawl.Journal.Day", { day: entry.travelDay });
  return `<li><span class="wastelander-hexcrawl-journal-when">${when}</span> <strong>${day}</strong> — ${message}${suffixHtml}</li>`;
}

function formatEntry(entry: JourneyLogEntry): string {
  switch (entry.kind) {
    case "enabled":
      return formatListItem(
        entry,
        escapeHtml(t("WASTELANDER.Hexcrawl.Journal.Enabled")),
      );
    case "disabled":
      return formatListItem(
        entry,
        escapeHtml(t("WASTELANDER.Hexcrawl.Journal.Disabled")),
      );
    case "hexEntered":
      return formatListItem(
        entry,
        escapeHtml(
          t("WASTELANDER.Hexcrawl.Journal.HexEntered", {
            hex: entry.hexKey ?? "?",
          }),
        ),
      );
    case "clockAdvanced":
      return formatListItem(
        entry,
        escapeHtml(
          t("WASTELANDER.Hexcrawl.Journal.ClockAdvanced", {
            minutes: entry.minutes ?? 0,
            speed: formatMphWithUnit(entry.mph ?? 0),
          }),
        ),
      );
    case "encounter": {
      const faces = entry.cdFaces?.join(", ") ?? "?";
      const label =
        entry.encounterName || entry.encounterType
          ? t("WASTELANDER.Hexcrawl.Journal.Encounter", {
              type: entry.encounterType ?? "",
              name: entry.encounterName ?? "",
            })
          : entry.error
            ? t("WASTELANDER.Hexcrawl.Journal.EncounterError", {
                faces,
                error: entry.error,
              })
            : t("WASTELANDER.Hexcrawl.Journal.EncounterNoEffect", { faces });
      const suffix = entry.encounterDescription
        ? `<div class="wastelander-hexcrawl-journal-desc">${escapeHtml(entry.encounterDescription)}</div>`
        : "";
      return formatListItem(entry, escapeHtml(label), suffix);
    }
    case "dayEnded":
      return formatListItem(
        entry,
        escapeHtml(
          t("WASTELANDER.Hexcrawl.Journal.DayEnded", {
            hours: formatHours(entry.note ? Number(entry.note) : 0),
          }),
        ),
      );
    case "campEncounter": {
      const faces = entry.cdFaces?.join(", ") ?? "?";
      const label =
        entry.encounterName || entry.encounterType
          ? t("WASTELANDER.Hexcrawl.Journal.CampEncounter", {
              type: entry.encounterType ?? "",
              name: entry.encounterName ?? "",
            })
          : entry.error
            ? t("WASTELANDER.Hexcrawl.Journal.CampEncounterError", {
                faces,
                error: entry.error,
              })
            : t("WASTELANDER.Hexcrawl.Journal.CampEncounterNoEffect", { faces });
      const suffix = entry.encounterDescription
        ? `<div class="wastelander-hexcrawl-journal-desc">${escapeHtml(entry.encounterDescription)}</div>`
        : "";
      return formatListItem(entry, escapeHtml(label), suffix);
    }
    case "campSet":
      return formatListItem(
        entry,
        escapeHtml(
          t("WASTELANDER.Hexcrawl.Journal.CampSet", {
            hex: entry.hexKey ?? "—",
            day: entry.travelDay,
          }),
        ),
      );
    case "courseCheck":
      return formatListItem(
        entry,
        escapeHtml(
          entry.passed
            ? t("WASTELANDER.Hexcrawl.Journal.CoursePass", {
                difficulty: entry.difficulty ?? 0,
              })
            : t("WASTELANDER.Hexcrawl.Journal.CourseFail", {
                difficulty: entry.difficulty ?? 0,
              }),
        ),
      );
    case "courseStatus":
      return formatListItem(
        entry,
        escapeHtml(
          entry.courseStatus === "lost"
            ? t("WASTELANDER.Hexcrawl.Journal.MarkedLost")
            : t("WASTELANDER.Hexcrawl.Journal.MarkedOnCourse"),
        ),
      );
    case "arrival":
      return formatListItem(
        entry,
        escapeHtml(t("WASTELANDER.Hexcrawl.Journal.Arrival")),
      );
    case "startingLocationSet":
      return formatListItem(
        entry,
        escapeHtml(
          t("WASTELANDER.Hexcrawl.Journal.StartingLocationSet", {
            hex: entry.hexKey ?? "?",
          }),
        ),
      );
    case "travelReset":
      return formatListItem(
        entry,
        escapeHtml(
          t("WASTELANDER.Hexcrawl.Journal.TravelReset", {
            hex: entry.hexKey ?? "—",
          }),
        ),
      );
    case "sceneCrossed":
      return formatListItem(
        entry,
        escapeHtml(
          t("WASTELANDER.Hexcrawl.Journal.SceneCrossed", {
            hex: entry.hexKey ?? "—",
            note: entry.note ?? "",
          }),
        ),
      );
    default:
      return "";
  }
}

export function renderHexcrawlJournalHtml(params: {
  state: HexcrawlSceneState;
}): string {
  const { state } = params;
  const entries = [...state.journeyLog]
    .sort((a, b) => b.at - a.at)
    .map(formatEntry)
    .join("\n");
  const statusLabel =
    state.courseStatus === "lost"
      ? t("WASTELANDER.Hexcrawl.CourseStatus.Lost")
      : t("WASTELANDER.Hexcrawl.CourseStatus.OnCourse");

  return `<div class="wastelander-hexcrawl-journal">
  <p>${escapeHtml(t("WASTELANDER.Hexcrawl.Journal.Summary", {
    day: state.travelDay,
    hours: formatHours(state.hoursTraveledToday),
    difficulty: state.currentDifficulty,
    status: statusLabel,
    hex: state.lastHexKey ?? "—",
  }))}</p>
  <ul class="wastelander-hexcrawl-journal-log">
    ${entries || `<li>${escapeHtml(t("WASTELANDER.Hexcrawl.Journal.Empty"))}</li>`}
  </ul>
</div>`;
}
