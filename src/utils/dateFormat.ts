// Global date formatting utility.
// All display timestamps render in the application's fixed business timezone —
// Africa/Nairobi — regardless of the viewer's browser/device timezone.
// DB storage stays UTC ISO 8601; this file only affects display and the
// interpretation of date-only filter/bucket boundaries.

export type DateInput = string | number | Date | null | undefined;

export const APP_TIMEZONE = "Africa/Nairobi";
export const APP_TZ_LABEL = "(UTC+03:00) Nairobi";

const pad = (n: number) => String(n).padStart(2, "0");

function toDate(input: DateInput): Date | null {
  if (input === null || input === undefined || input === "") return null;
  const d = input instanceof Date ? input : new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * The Y/M/D/H/M/S of `date` as they read on a wall clock in `timeZone` —
 * looked up via Intl/ICU's IANA timezone database, never a hardcoded offset.
 */
function partsInZone(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    year: +parts.year,
    month: +parts.month,
    day: +parts.day,
    hour: +parts.hour === 24 ? 0 : +parts.hour,
    minute: +parts.minute,
    second: +parts.second,
  };
}

/** UTC-minus-local offset (ms) of `timeZone` at `date` — positive east of UTC. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
}

/** DD-MM-YYYY (or DD-MM-YYYY, HH:MM when includeTime=true), in Africa/Nairobi. */
export function formatDate(dateInput: DateInput, includeTime = false): string {
  const d = toDate(dateInput);
  if (!d) return "—";
  const p = partsInZone(d, APP_TIMEZONE);
  const datePart = `${pad(p.day)}-${pad(p.month)}-${p.year}`;
  if (!includeTime) return datePart;
  return `${datePart}, ${pad(p.hour)}:${pad(p.minute)}`;
}

// Short DD-MM, for chart axis labels — in Africa/Nairobi.
export function formatDateShort(dateInput: DateInput): string {
  const d = toDate(dateInput);
  if (!d) return "—";
  const p = partsInZone(d, APP_TIMEZONE);
  return `${pad(p.day)}-${pad(p.month)}`;
}

/**
 * The Y/M/D of `dateInput` as displayed in the application timezone. Use this
 * — never local `getFullYear`/`getMonth`/`getDate` on the raw Date — when
 * grouping tickets into day/week/month buckets, so charts and "today"
 * calculations bucket by the Nairobi calendar day, not the viewer's.
 */
export function getAppYMD(dateInput: DateInput): { year: number; month: number; day: number } | null {
  const d = toDate(dateInput);
  if (!d) return null;
  const p = partsInZone(d, APP_TIMEZONE);
  return { year: p.year, month: p.month, day: p.day };
}

/**
 * Whole-calendar-day difference (a − b) counted by Nairobi calendar dates —
 * the timezone-aware equivalent of date-fns's `differenceInCalendarDays`,
 * which truncates to midnight in the browser's own local timezone.
 */
export function getAppCalendarDayDiff(a: DateInput, b: DateInput): number {
  const ay = getAppYMD(a);
  const by = getAppYMD(b);
  if (!ay || !by) return 0;
  const aUtc = Date.UTC(ay.year, ay.month - 1, ay.day);
  const bUtc = Date.UTC(by.year, by.month - 1, by.day);
  return Math.round((aUtc - bUtc) / 86400000);
}

/**
 * The UTC instant of a given Nairobi calendar day's start (00:00:00.000) and
 * end (23:59:59.999). `pickedLocalDate` is a Date carrying the intended Y/M/D
 * (e.g. from a calendar picker, using its own local getters) — only its
 * calendar-day components are used, never its instant, so the result is the
 * same regardless of the viewer's own browser timezone.
 */
export function zonedDayRangeUtc(pickedLocalDate: Date): { start: Date; end: Date } {
  const y = pickedLocalDate.getFullYear();
  const m = pickedLocalDate.getMonth();
  const d = pickedLocalDate.getDate();
  const guess = new Date(Date.UTC(y, m, d, 0, 0, 0, 0));
  const offset = zoneOffsetMs(guess, APP_TIMEZONE);
  const start = new Date(guess.getTime() - offset);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

/** Today's calendar date in the application timezone, as YYYY-MM-DD. */
export function getAppTodayStr(): string {
  const p = partsInZone(new Date(), APP_TIMEZONE);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** The calendar date `days` real days ago, read in the application timezone. */
export function getAppDateStrDaysAgo(days: number): string {
  const p = partsInZone(new Date(Date.now() - days * 86400000), APP_TIMEZONE);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
