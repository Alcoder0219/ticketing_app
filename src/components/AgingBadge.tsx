import { useEffect, useState } from "react";
import { calculateAgingDays, formatAgingLabel, agingColorClass, getTicketEndDate, isTicketClosed } from "@/lib/aging";
import { cn } from "@/lib/utils";

interface AgingBadgeProps {
  createdAt: string;
  status: string;
  resolvedAt?: string | null;
  closedAt?: string | null;
  className?: string;
  withLabel?: boolean;
}

/**
 * Auto-updating aging display. For open tickets, recomputes every hour.
 * For resolved/closed tickets, shows a fixed gray value.
 */
export function AgingBadge({ createdAt, status, resolvedAt, closedAt, className, withLabel = false }: AgingBadgeProps) {
  const closed = isTicketClosed(status);
  const endDate = getTicketEndDate({ status, resolved_at: resolvedAt, closed_at: closedAt });
  const [, force] = useState(0);

  useEffect(() => {
    if (closed) return;
    const interval = setInterval(() => force((n) => n + 1), 60 * 60 * 1000); // hourly tick
    return () => clearInterval(interval);
  }, [closed]);

  const days = calculateAgingDays(createdAt, endDate);
  const color = agingColorClass(days, closed);

  return (
    <span className={cn(color, className)}>
      {withLabel ? "Aging: " : ""}{formatAgingLabel(days)}
    </span>
  );
}

export function computeAgingDaysForTicket(ticket: { created_at: string; status: string; resolved_at?: string | null; closed_at?: string | null }): number {
  const endDate = getTicketEndDate({ status: ticket.status, resolved_at: ticket.resolved_at, closed_at: ticket.closed_at });
  return calculateAgingDays(ticket.created_at, endDate);
}
