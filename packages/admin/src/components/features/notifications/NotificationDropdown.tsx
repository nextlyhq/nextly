/**
 * F10 PR 5 — the dropdown panel rendered when the bell is clicked.
 *
 * States:
 *   - loading:  spinner placeholder
 *   - error:    "Failed to load. Try again." with a Retry button
 *   - empty:    "No schema changes yet."
 *   - rows:     list of NotificationRow + optional "Load more" button
 *
 * The bell controls open/close + lastSeen. This component is dumb:
 * it consumes `useJournal()` and renders. "Load more" appends the
 * next page in local state so users can scroll back without
 * losing the rows already on screen.
 *
 * @module components/features/notifications/NotificationDropdown
 */

import { useState } from "react";

import { Button } from "@admin/components/ui";
import { JOURNAL_PAGE_SIZE, useJournal } from "@admin/hooks/queries/useJournal";
import { journalApi, type JournalRow } from "@admin/services/journalApi";

import { NotificationRow } from "./NotificationRow";

const PAGE_SIZE = JOURNAL_PAGE_SIZE;

export function NotificationDropdown(): JSX.Element {
  const [extraRows, setExtraRows] = useState<JournalRow[]>([]);
  const [moreHasMore, setMoreHasMore] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useJournal({
    limit: PAGE_SIZE,
  });

  const firstPageRows = data?.rows ?? [];
  const firstPageHasMore = data?.hasMore ?? false;
  const allRows = [...firstPageRows, ...extraRows];
  // After the first "load more" the trailing page's hasMore wins;
  // before that, the React-Query first page's hasMore is the source.
  const hasMore = extraRows.length > 0 ? moreHasMore : firstPageHasMore;

  const oldestStartedAt = allRows.length
    ? allRows[allRows.length - 1].startedAt
    : undefined;

  async function loadMore(): Promise<void> {
    if (!oldestStartedAt) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = await journalApi.list({
        limit: PAGE_SIZE,
        before: oldestStartedAt,
      });
      setExtraRows(prev => [...prev, ...next.rows]);
      setMoreHasMore(next.hasMore);
    } catch (err) {
      setMoreError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div
      data-testid="notification-dropdown"
      className="w-96 max-h-[480px] overflow-y-auto"
    >
      <div className="px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-sm">Recent schema changes</h3>
      </div>

      {isLoading && (
        <div
          data-testid="notification-dropdown-loading"
          className="px-4 py-6 text-center text-sm text-muted-foreground"
        >
          Loading…
        </div>
      )}

      {isError && !isLoading && (
        <div
          data-testid="notification-dropdown-error"
          className="px-4 py-6 text-center text-sm"
        >
          <p className="text-destructive mb-2">Failed to load.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      )}

      {!isLoading && !isError && allRows.length === 0 && (
        <div
          data-testid="notification-dropdown-empty"
          className="px-4 py-6 text-center text-sm text-muted-foreground"
        >
          No schema changes yet.
        </div>
      )}

      {!isLoading && !isError && allRows.length > 0 && (
        <>
          <div data-testid="notification-dropdown-list">
            {allRows.map(row => (
              <NotificationRow key={row.id} row={row} />
            ))}
          </div>
          {hasMore && (
            <div className="px-4 py-3 border-t border-border text-center">
              {moreError && (
                <p className="text-destructive text-xs mb-2">{moreError}</p>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                data-testid="notification-dropdown-load-more"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Test seam: page size used by both the React-Query call and the
// "load more" call. Exported so tests can construct cursor scenarios
// without hard-coding the constant.
export const NOTIFICATION_DROPDOWN_PAGE_SIZE = PAGE_SIZE;
