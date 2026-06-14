/** Simple Calendar Reborn — optional world clock integration. */

export type WorldClockDateTimeDisplay = {
  date?: string;
  time?: string;
};

export type WorldClockAdvanceResult =
  | {
      ok: true;
      advanced: true;
      minutes: number;
      clockLabel?: string;
      clockBefore?: string;
      clockAfter?: string;
    }
  | {
      ok: true;
      advanced: false;
      reason: "disabled" | "unavailable" | "zero";
    }
  | {
      ok: false;
      advanced: false;
      error: string;
    };

type SimpleCalendarApi = {
  changeDate?: (interval: {
    year?: number;
    month?: number;
    day?: number;
    hour?: number;
    minute?: number;
    seconds?: number;
  }) => boolean;
  currentDateTimeDisplay?: () => WorldClockDateTimeDisplay | null;
};

function getSimpleCalendarApi(): SimpleCalendarApi | undefined {
  const sc = (globalThis as { SimpleCalendar?: { api?: SimpleCalendarApi } })
    .SimpleCalendar;
  return sc?.api;
}

export function formatWorldClockDisplay(
  display: WorldClockDateTimeDisplay | null | undefined,
): string | undefined {
  if (!display) return undefined;
  const label = [display.date, display.time].filter(Boolean).join(" ").trim();
  return label || undefined;
}

/** Current in-game date/time label from Simple Calendar, if available. */
export function getWorldClockLabel(): string | undefined {
  const api = getSimpleCalendarApi();
  return formatWorldClockDisplay(api?.currentDateTimeDisplay?.());
}

export function isWorldClockAvailable(): boolean {
  return typeof getSimpleCalendarApi()?.changeDate === "function";
}

/**
 * Advance the active Simple Calendar by the given number of minutes.
 * Splits into hours + minutes when >= 60 for cleaner calendar rollover.
 */
export function advanceWorldClockMinutes(minutes: number): WorldClockAdvanceResult {
  const total = Math.max(0, Math.floor(minutes));
  if (total <= 0) {
    return { ok: true, advanced: false, reason: "zero" };
  }

  const api = getSimpleCalendarApi();
  if (!api?.changeDate) {
    return { ok: true, advanced: false, reason: "unavailable" };
  }

  const clockBefore = formatWorldClockDisplay(api.currentDateTimeDisplay?.());

  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  const interval: {
    hour?: number;
    minute?: number;
  } = {};
  if (hours > 0) interval.hour = hours;
  if (remainder > 0) interval.minute = remainder;

  const changed = api.changeDate(interval);
  if (!changed) {
    return {
      ok: false,
      advanced: false,
      error: "Simple Calendar rejected the date change (permissions or invalid interval).",
    };
  }

  const clockAfter = formatWorldClockDisplay(api.currentDateTimeDisplay?.());

  return {
    ok: true,
    advanced: true,
    minutes: total,
    clockLabel: clockAfter,
    clockBefore,
    clockAfter,
  };
}
