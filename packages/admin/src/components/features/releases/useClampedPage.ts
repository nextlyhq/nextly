"use client";

/**
 * @module components/features/releases/useClampedPage
 */
import { useEffect } from "react";

/**
 * Keep a paged release list on a page that exists.
 *
 * Shared by the list's tabs and the calendar's day list, which page the same
 * way. A list shrinks under the reader: the only release on the last page is
 * published, cancelled or deleted, here or by the runner between two polls.
 * The server then answers a page past the end with no rows, and the list would
 * show its empty state with no pager to get back. So once an answer for this
 * page (not a placeholder from the last one) says the page is past the end,
 * the list moves to the last page, or the first when the list is empty.
 */
export function useClampedPage(
  q: { page: number; pageSize: number; setPage: (page: number) => void },
  total: number | undefined
): void {
  const { page, pageSize, setPage } = q;
  useEffect(() => {
    if (total === undefined) return;
    const last = Math.max(0, Math.ceil(total / pageSize) - 1);
    if (page > last) setPage(last);
  }, [total, page, pageSize, setPage]);
}
