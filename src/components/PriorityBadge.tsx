import { useTranslation } from "react-i18next";
import { priorityColor, priorityMap } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

interface PriorityBadgeProps {
  priority: string;
  className?: string;
}

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  // Display only — the stored priority value is never changed.
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        priorityColor[priority] || "bg-muted text-muted-foreground border-border",
        className
      )}
    >
      {t(`priority.${priority}`, { defaultValue: priorityMap[priority] || priority })}
    </span>
  );
}
