import { useTranslation } from "react-i18next";
import { TicketStatus, statusColor } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: TicketStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  // Display only — the stored ticket status value is never changed.
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        statusColor[status],
        className
      )}
    >
      {t(`status.${status}`, { defaultValue: status })}
    </span>
  );
}
