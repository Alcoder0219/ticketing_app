import { useSearchParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { ReactNode, MouseEvent } from "react";

interface TicketIdLinkProps {
  ticketNumber: string;
  className?: string;
  children?: ReactNode;
}

/**
 * Renders a Ticket ID (e.g. TKT-2026-0069) as a clickable element.
 * Clicking sets the ?ticket=<number> URL param, which opens the global
 * <TicketDetailPanel /> slide-over.
 */
export function TicketIdLink({ ticketNumber, className, children }: TicketIdLinkProps) {
  const [params, setParams] = useSearchParams();

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const next = new URLSearchParams(params);
    next.set("ticket", ticketNumber);
    setParams(next, { replace: false });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "text-blue-600 hover:underline cursor-pointer font-mono font-semibold focus:outline-none whitespace-nowrap",
        className
      )}
      title={`View ${ticketNumber}`}
    >
      {children ?? ticketNumber}
    </button>
  );
}
