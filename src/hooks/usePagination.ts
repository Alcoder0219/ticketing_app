import { useEffect, useState } from "react";

export const DEFAULT_PAGE_SIZE = 25;

export interface UsePaginationOptions {
  /** Records per page. Defaults to 25 app-wide. */
  pageSize?: number;
  /**
   * Any value that identifies the current filter/search state. Changing it
   * (by reference/value via useEffect's dep comparison) resets the page back
   * to 1 — pass a serialized string of every active filter, excluding page.
   */
  resetKey?: unknown;
}

export interface UsePaginationResult {
  page: number;
  pageSize: number;
  /** Maps directly onto QueryBuilder.range(from, to). */
  range: { from: number; to: number };
  setPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
}

export function usePagination(opts?: UsePaginationOptions): UsePaginationResult {
  const pageSize = opts?.pageSize ?? DEFAULT_PAGE_SIZE;
  const [page, setPage] = useState(1);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setPage(1);
  }, [opts?.resetKey]);

  const from = (page - 1) * pageSize;
  const to = page * pageSize - 1;

  return {
    page,
    pageSize,
    range: { from, to },
    setPage,
    nextPage: () => setPage((p) => p + 1),
    prevPage: () => setPage((p) => Math.max(1, p - 1)),
  };
}
