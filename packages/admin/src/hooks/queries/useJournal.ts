/**
 * F10 PR 5 — TanStack Query hook for the schema journal endpoint.
 *
 * Powers the NotificationBell + Dropdown. Fetches recent applies from
 * `GET /api/schema/journal`. Refetch on window focus is OFF here
 * because the bell's `useUnreadCount` hook drives the refresh on
 * `visibilitychange` instead — that gives precise control over when
 * the badge math re-runs (and avoids redundant duplicate fetches).
 *
 * @module hooks/queries/useJournal
 */

import { useQuery } from "@tanstack/react-query";

import {
  journalApi,
  type JournalListResponse,
  type ListJournalParams,
} from "@admin/services/journalApi";

export const JOURNAL_QUERY_KEY = ["schema", "journal"] as const;

// Default page size for the journal queries. Single source of truth
// shared by the bell (badge math + first-page fetch) and the dropdown
// (load-more cursor) so they can never diverge on page size.
export const JOURNAL_PAGE_SIZE = 20;

export function useJournal(params: ListJournalParams = {}) {
  return useQuery<JournalListResponse, Error>({
    queryKey: [
      ...JOURNAL_QUERY_KEY,
      params.limit ?? JOURNAL_PAGE_SIZE,
      params.before ?? null,
    ],
    queryFn: () => journalApi.list(params),
    staleTime: 10_000,
    gcTime: 5 * 60 * 1000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
