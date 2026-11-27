"use client";

/**
 * The signed-in person's Inbox: the unread count on its button, each tab's
 * unread count and newest page while it is open, and marking items read or
 * unread, which refreshes them all. Read state is the server's alone: nothing
 * here is kept in the browser beyond React Query's own cache.
 *
 * @module components/features/notifications/useNotices
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  noticesApi,
  type InboxTab,
  type MarkNoticesRead,
  type NoticeListResponse,
} from "./notices-api";

/** Every Inbox read, so a mark refreshes them all at once. */
const NOTICES_KEY = ["notices"] as const;

/** How often the count is asked again while the admin is visible. */
const INBOX_REFRESH_MS = 60_000;

/** A tab's newest items, asked for only while the Inbox is open on it. */
export function useNoticeList(
  tab: InboxTab,
  enabled: boolean
): UseQueryResult<NoticeListResponse, Error> {
  return useQuery({
    queryKey: [...NOTICES_KEY, "list", tab],
    queryFn: () => noticesApi.list(tab),
    enabled,
    staleTime: 10_000,
    retry: 1,
  });
}

/**
 * How many items are unread, for the Inbox button: one request, asked again
 * when the admin's browser tab regains focus and every minute while it is
 * visible, so a read in another browser or a new item shows without a reload.
 */
export function useUnreadNoticeCount(): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: [...NOTICES_KEY, "unread"],
    queryFn: () => noticesApi.unreadCount(),
    staleTime: 10_000,
    refetchInterval: INBOX_REFRESH_MS,
    // The admin turns refetching on focus off by default; the count is the
    // one answer that must be current whenever the person comes back.
    refetchOnWindowFocus: "always",
    retry: 1,
  });
}

/** One tab's unread count, asked for only while the Inbox is open. */
export function useTabUnreadCount(
  tab: InboxTab,
  enabled: boolean
): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: [...NOTICES_KEY, "unread", tab],
    queryFn: () => noticesApi.unreadCount(tab),
    enabled,
    staleTime: 10_000,
    retry: 1,
  });
}

/** Mark items read, then read the counts and lists again. */
export function useMarkNoticesRead(): UseMutationResult<
  { marked: number },
  Error,
  MarkNoticesRead
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MarkNoticesRead) => noticesApi.markRead(body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [...NOTICES_KEY] }),
  });
}

/** Make items unread again, then read the counts and lists again. */
export function useMarkNoticesUnread(): UseMutationResult<
  { marked: number },
  Error,
  { ids: string[] }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids: string[] }) => noticesApi.markUnread(body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [...NOTICES_KEY] }),
  });
}
