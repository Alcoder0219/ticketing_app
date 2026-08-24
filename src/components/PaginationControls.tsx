import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";
import type { PageMeta } from "@/lib/pagination";

export interface PaginationControlsProps {
  meta: PageMeta;
  onPageChange: (page: number) => void;
  isLoading?: boolean;
  /** Plural label for the record type, e.g. "tickets", "users". */
  label?: string;
  className?: string;
}

/** Current page ±2, plus first/last, with ellipses for gaps. */
function pageWindow(current: number, totalPages: number): (number | "ellipsis")[] {
  const pages = new Set<number>();
  pages.add(1);
  pages.add(totalPages);
  for (let p = current - 2; p <= current + 2; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const out: (number | "ellipsis")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (prev && p - prev > 1) out.push("ellipsis");
    out.push(p);
    prev = p;
  }
  return out;
}

export function PaginationControls({
  meta,
  onPageChange,
  isLoading,
  label = "records",
  className,
}: PaginationControlsProps) {
  const { page, total, totalPages, hasNextPage, hasPreviousPage, from, to } = meta;

  const go = (p: number) => {
    if (p < 1 || p > totalPages || p === page || isLoading) return;
    onPageChange(p);
  };

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 sm:flex-row sm:justify-between",
        className,
      )}
    >
      <p className="text-sm text-muted-foreground order-2 sm:order-1">
        {total === 0
          ? `No ${label} found`
          : `Showing ${from}–${to} of ${total} ${label}`}
      </p>

      <Pagination className="order-1 sm:order-2 mx-0 w-auto">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              aria-disabled={!hasPreviousPage || isLoading}
              className={
                !hasPreviousPage || isLoading ? "pointer-events-none opacity-50" : undefined
              }
              onClick={(e) => {
                e.preventDefault();
                go(page - 1);
              }}
            />
          </PaginationItem>

          {totalPages > 1 &&
            pageWindow(page, totalPages).map((p, i) =>
              p === "ellipsis" ? (
                <PaginationItem key={`e-${i}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink
                    href="#"
                    isActive={p === page}
                    onClick={(e) => {
                      e.preventDefault();
                      go(p);
                    }}
                  >
                    {p}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}

          <PaginationItem>
            <PaginationNext
              href="#"
              aria-disabled={!hasNextPage || isLoading}
              className={
                !hasNextPage || isLoading ? "pointer-events-none opacity-50" : undefined
              }
              onClick={(e) => {
                e.preventDefault();
                go(page + 1);
              }}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
