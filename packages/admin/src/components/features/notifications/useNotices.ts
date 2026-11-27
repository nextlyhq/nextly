"use client";

/**
 * The signed-in person's Inbox: the unread counts its button and tabs draw,
 * each tab's newest page while it is open, and marking items read or unread,
 * which refreshes them all. Read state is the server's alone: nothing
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

import { toast } from "@admin/components/ui";

import {
  noticesApi,
  type InboxCounts,
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
 * How many items are unread, in all and in Alerts: one request that the Inbox
 * button and both tab counts read, so they always agree. It is asked again when
 * the admin's browser tab regains focus and every minute while it is visible,
 * so a read in another browser or a new item shows without a reload.
 *
 * `freshOnMount` asks again as the caller mounts, for the popover: the tab it
 * opens on is chosen from these counts, so a count kept from before it opened
 * must not choose it.
 */
export function useUnreadNoticeCounts({
  freshOnMount = false,
}: { freshOnMount?: boolean } = {}): UseQueryResult<InboxCounts, Error> {
  return useQuery({
    queryKey: [...NOTICES_KEY, "unread"],
    queryFn: () => noticesApi.unreadCounts(),
    staleTime: 10_000,
    refetchInterval: INBOX_REFRESH_MS,
    // The admin turns refetching on focus off by default; the count is the
    // one answer that must be current whenever the person comes back.
    refetchOnWindowFocus: "always",
    ...(freshOnMount ? { refetchOnMount: "always" as const } : {}),
    retry: 1,
  });
}

/** A tab's share of the counts: Alerts is counted, For you is the rest. */
export function tabUnread(
  counts: InboxCounts | undefined,
  tab: InboxTab
): number {
  if (counts === undefined) return 0;
  return tab === "alerts" ? counts.alerts : counts.total - counts.alerts;
}

/** What a mark that did not reach the server says, so it never fails unseen. */
function markFailed(): void {
  toast.error("Your Inbox could not be updated", {
    description: "Nothing was changed. Try again in a moment.",
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
    onError: markFailed,
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
    onError: markFailed,
  });
}
