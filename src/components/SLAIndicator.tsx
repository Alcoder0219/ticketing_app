import { AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SLAIndicatorProps {
  targetDate: string | null;
  nextTargetDate?: string | null;
  status: string;
  className?: string;
}

/**
 * Date-only diff using the effective target (next_target_date overrides target_date when set).
 * - diff > 0  → "Due in Xd" (neutral)
 * - diff === 0 → "Due Today" (amber)
 * - diff < 0  → "Overdue by Xd" (red)
 * - null target → render nothing
 */
export function SLAIndicator({ targetDate, nextTargetDate, status, className }: SLAIndicatorProps) {
  const effective = nextTargetDate || targetDate;
  if (!effective || status === "closed" || status === "resolved") return null;

  const target = new Date(effective);
  const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.round((targetMidnight - todayMidnight) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs font-semibold text-red-600", className)}>
        <AlertTriangle className="h-3 w-3" />
        Overdue by {Math.abs(diffDays)}d
      </span>
    );
  }

  if (diffDays === 0) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs font-semibold text-amber-600", className)}>
        <Clock className="h-3 w-3" />
        Due Today
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
      <CheckCircle2 className="h-3 w-3" />
      Due in {diffDays}d
    </span>
  );
}
