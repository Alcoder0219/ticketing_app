/**
 * Application-timezone date formatting.
 *
 * The server/Cloud Run process clock and TZ are left untouched — this module
 * explicitly renders any timestamp in the application's fixed business
 * timezone (Africa/Nairobi) via Intl/ICU's IANA database, independent of
 * whatever timezone the host process happens to run in. Database timestamps
 * are unaffected: they stay UTC `Date` values; only display formatting (email
 * bodies) goes through here.
 */

export const APP_TIMEZONE = 'Africa/Nairobi';
export const APP_TZ_LABEL = '(UTC+03:00) Nairobi';

const pad = (n: number) => String(n).padStart(2, '0');

function partsInZone(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
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

/** DD-MM-YYYY (or DD-MM-YYYY, HH:MM when withTime=true), in Africa/Nairobi. */
export function formatAppDateTime(value: unknown, withTime = true): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(String(value));
  if (isNaN(d.getTime())) return '';
  const p = partsInZone(d, APP_TIMEZONE);
  const date = `${pad(p.day)}-${pad(p.month)}-${p.year}`;
  return withTime ? `${date}, ${pad(p.hour)}:${pad(p.minute)}` : date;
}
