"use client";

import { useCallback, useState } from "react";

import { PAGINATION } from "@admin/constants/pagination";

/**
 * The page/size state a paginated list runs on, with the resets built in.
 *
 * Every admin list needs the same three rules, and they are rules about STATE
 * rather than about rendering:
 *
 * - a page-size change returns to the first page
 * - a search or filter change returns to the first page
 * - a page change is just a page change
 *
 * The first two exist because `page` is an index into a list whose length the
 * change has just altered. Keeping page 3 while growing the page size asks for
 * rows past the end, and the table renders its empty message over a list that
 * has rows — a defect that reads as "no results" rather than as a paging bug,
 * which is why it survived on one surface unnoticed.
 *
 * This lives in a hook rather than in `Pagination` deliberately. The rule is
 * about the state the caller owns, and `Pagination` is presentational: giving
 * it the reset would mean a control emitting a page change nobody asked it for,
 * and would still leave every caller free not to use it. A hook cannot be
 * bypassed by the callers that adopt it, and it composes — `useServerTable`
 * builds on this rather than restating it.
 */
export interface PaginationState {
  /** Current page index, 0-based. */
  page: number;
  /** Rows per page. */
  pageSize: number;
  /** Go to a page. The only move that does not reset anything. */
  setPage: (page: number) => void;
  /**
   * Change the page size and return to the first page.
   *
   * Both in one update so React batches them into a single render, and any
   * query keyed on `{ page, pageSize }` therefore refetches once rather than
   * once per setter.
   */
  setPageSize: (pageSize: number) => void;
  /**
   * Return to the first page, for a change that alters which rows exist —
   * a search term, a filter, a switch of collection.
   */
  resetPage: () => void;
}

export interface UsePaginationOptions {
  /** Starting page index, 0-based. Defaults to the first page. */
  initialPage?: number;
  /** Starting rows per page. */
  initialPageSize?: number;
}

/**
 * Pagination state for a list, with the first-page resets applied.
 *
 * ```tsx
 * const { page, pageSize, setPage, setPageSize, resetPage } = usePagination({
 *   initialPageSize: 10,
 * });
 *
 * useEffect(() => resetPage(), [search, resetPage]);
 *
 * <DataTableView
 *   rows={rows}
 *   footer={
 *     <Pagination
 *       currentPage={page}
 *       pageSize={pageSize}
 *       onPageChange={setPage}
 *       onPageSizeChange={setPageSize}
 *     />
 *   }
 * />
 * ```
 */
export function usePagination(
  options: UsePaginationOptions = {}
): PaginationState {
  // Defaults come from the pagination constants rather than being written out
  // again here. Two copies of "a table starts on page 0 showing 10 rows" agree
  // until one is changed, and the one that gets changed is whichever the next
  // reader finds first.
  const {
    initialPage = PAGINATION.DEFAULT_PAGE,
    initialPageSize = PAGINATION.TABLE_DEFAULT_PAGE_SIZE,
  } = options;

  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  const setPageSize = useCallback((next: number) => {
    setPageSizeState(next);
    setPage(PAGINATION.DEFAULT_PAGE);
  }, []);

  const resetPage = useCallback(() => {
    setPage(PAGINATION.DEFAULT_PAGE);
  }, []);

  return { page, pageSize, setPage, setPageSize, resetPage };
}
