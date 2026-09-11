import { AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAppYMD } from "@/utils/dateFormat";

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

  // Day-only diff, evaluated by the application's Nairobi calendar day rather
  // than the viewer's own browser timezone — two users in different countries
  // must see the same "Due Today"/"Overdue" classification.
  const targetYmd = getAppYMD(effective)!;
  const todayYmd = getAppYMD(new Date())!;
  const targetMidnight = Date.UTC(targetYmd.year, targetYmd.month - 1, targetYmd.day);
  const todayMidnight = Date.UTC(todayYmd.year, todayYmd.month - 1, todayYmd.day);
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
