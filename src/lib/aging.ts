// Centralized aging calculation. Use this everywhere.
export function calculateAgingDays(createdAt: string | Date, closedAt?: string | Date | null): number {
  if (!createdAt) return 0;
  const start = new Date(createdAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const diff = end - start;
  if (!isFinite(diff) || diff <= 0) return 0;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export function formatAgingLabel(days: number): string {
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export function agingColorClass(days: number, isClosed: boolean): string {
  if (isClosed) return "text-muted-foreground";
  if (days <= 2) return "text-green-600";
  if (days <= 7) return "text-amber-600";
  if (days <= 14) return "text-red-600";
  return "text-red-800 font-bold";
}

export const AGING_FILTER_OPTIONS = [
  { value: "all", label: "All Aging" },
  { value: "0-2", label: "0–2 days (fresh)" },
  { value: "3-7", label: "3–7 days" },
  { value: "8-14", label: "8–14 days" },
  { value: "15+", label: "15+ days (critical)" },
] as const;

export type AgingFilterValue = (typeof AGING_FILTER_OPTIONS)[number]["value"];

export function matchesAgingFilter(days: number, filter: AgingFilterValue): boolean {
  switch (filter) {
    case "all": return true;
    case "0-2": return days >= 0 && days <= 2;
    case "3-7": return days >= 3 && days <= 7;
    case "8-14": return days >= 8 && days <= 14;
    case "15+": return days >= 15;
  }
}

export function isTicketClosed(status: string): boolean {
  return status === "resolved" || status === "closed";
}

export function getTicketEndDate(ticket: { status?: string; resolved_at?: string | null; closed_at?: string | null }): string | null {
  if (!isTicketClosed(ticket.status || "")) return null;
  return ticket.closed_at || ticket.resolved_at || null;
}
