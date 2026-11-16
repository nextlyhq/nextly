"use client";

/**
 * The signed-in person's notices for the bell: the newest page, the unread
 * count on the bell, and marking them read, which refreshes both.
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
  type MarkNoticesRead,
  type NoticeListResponse,
} from "./notices-api";

/** Every notices read, so a mark-read refreshes them all at once. */
const NOTICES_KEY = ["notices"] as const;

/** The newest notices, asked for only while the bell is open. */
export function useNoticeList(
  enabled: boolean
): UseQueryResult<NoticeListResponse, Error> {
  return useQuery({
    queryKey: [...NOTICES_KEY, "list"],
    queryFn: () => noticesApi.list(),
    enabled,
    staleTime: 10_000,
    retry: 1,
  });
}

/**
 * How many notices are unread, for the bell's badge. Asked again every
 * minute, so a notice written while the admin is open is counted without a
 * reload.
 */
export function useUnreadNoticeCount(): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: [...NOTICES_KEY, "unread"],
    queryFn: () => noticesApi.unreadCount(),
    staleTime: 10_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}

/** Mark notices read, then read the list and the count again. */
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
