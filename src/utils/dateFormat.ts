// Global date formatting utility.
// Always render dates as DD-MM-YYYY (or DD-MM-YYYY, HH:MM when includeTime=true).
// DB storage stays ISO 8601 — this only affects display.

export type DateInput = string | number | Date | null | undefined;

const pad = (n: number) => String(n).padStart(2, "0");

export function formatDate(dateInput: DateInput, includeTime = false): string {
  if (dateInput === null || dateInput === undefined || dateInput === "") return "—";
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return "—";
  const datePart = `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
  if (!includeTime) return datePart;
  return `${datePart}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Short DD-MM, for chart axis labels.
export function formatDateShort(dateInput: DateInput): string {
  if (dateInput === null || dateInput === undefined || dateInput === "") return "—";
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return "—";
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}`;
}
