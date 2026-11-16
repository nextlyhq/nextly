/**
 * The Email hub's Activity reads, as TanStack Query hooks.
 *
 * `useEmailActivity` answers one newest-first list of the delivery log and
 * queued email, a page at a time. The server answers each as a list paged by
 * its own cursor, so each page here reads the next page of every list that
 * has more, and the rows are merged by `mergeNewestFirst`, which holds back
 * what a list still loading could precede. The screen sees one list, and
 * does not change when the server answers one merged list itself.
 *
 * Query keys:
 * - `["emailActivity"]`, the base key
 * - `["emailActivity", "list", sources]`, one filtered list
 * - `["emailActivity", "overdue"]`, whether queued email is overdue
 *
 * @module hooks/queries/useEmailActivity
 */

import {
  useInfiniteQuery,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useMemo } from "react";

import {
  deliveryRow,
  mergeNewestFirst,
  queuedRow,
  sourcesFor,
  type ActivityFilter,
  type ActivityRow,
  type LoadedSource,
} from "@admin/components/features/email-hub/activity/activity-model";
import {
  getQueuedEmailOverdue,
  listDeliveryActivity,
  listQueuedEmailActivity,
  type QueuedEmailOverdue,
} from "@admin/services/emailActivityApi";

/** How many records each list answers per page. */
const ACTIVITY_PAGE_SIZE = 50;

/** How often the overdue check is asked again while the hub is open. */
const OVERDUE_POLL_MS = 60_000;

type Sources = ReturnType<typeof sourcesFor>;

export const emailActivityKeys = {
  all: () => ["emailActivity"] as const,
  list: (sources: Sources) =>
    [...emailActivityKeys.all(), "list", sources] as const,
  overdue: () => [...emailActivityKeys.all(), "overdue"] as const,
};

/**
 * Where each list's next page starts: `undefined` for its first page, its
 * cursor after that, and `null` once it has nothing more or is not asked.
 */
interface ActivityCursor {
  deliveries: string | undefined | null;
  queued: string | undefined | null;
}

/** One page: each list's rows read for it, and where each goes on from. */
interface ActivityPage {
  deliveries: ActivityRow[];
  queued: ActivityRow[];
  next: ActivityCursor;
}

/** The merged list, and the paging the screen drives. */
export interface EmailActivityResult {
  rows: ActivityRow[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

/**
 * One newest-first list of the delivery log and queued email, narrowed by
 * `filter`. The time window is measured from when the filter was chosen, so
 * paging further does not move it.
 */
export function useEmailActivity(
  filter: ActivityFilter,
  options: { enabled?: boolean } = {}
): EmailActivityResult {
  const filterKey = JSON.stringify(filter);
  // Measured once per filter: the key holds the window's start, and a key
  // that moved with the clock would never stay cached.
  // Read back from the key, so the memo depends on the filter's value and
  // not on a new object with the same value each render.
  const sources = useMemo(
    () => sourcesFor(JSON.parse(filterKey) as ActivityFilter, new Date()),
    [filterKey]
  );

  const query = useInfiniteQuery({
    queryKey: emailActivityKeys.list(sources),
    initialPageParam: {
      deliveries: sources.deliveries ? undefined : null,
      queued: sources.queued ? undefined : null,
    },
    queryFn: async ({ pageParam }): Promise<ActivityPage> => {
      const [deliveries, queued] = await Promise.all([
        pageParam.deliveries === null || sources.deliveries === null
          ? null
          : listDeliveryActivity({
              ...sources.deliveries,
              ...(pageParam.deliveries ? { before: pageParam.deliveries } : {}),
              limit: ACTIVITY_PAGE_SIZE,
            }),
        pageParam.queued === null || sources.queued === null
          ? null
          : listQueuedEmailActivity({
              ...sources.queued,
              ...(pageParam.queued ? { before: pageParam.queued } : {}),
              limit: ACTIVITY_PAGE_SIZE,
            }),
      ]);
      return {
        deliveries: deliveries?.items.map(deliveryRow) ?? [],
        queued: queued?.items.map(queuedRow) ?? [],
        next: {
          deliveries: deliveries?.meta.nextBefore ?? null,
          queued: queued?.meta.nextBefore ?? null,
        },
      };
    },
    getNextPageParam: last =>
      last.next.deliveries === null && last.next.queued === null
        ? undefined
        : last.next,
    enabled: options.enabled ?? true,
  });

  const pages = query.data?.pages;
  const rows = useMemo(() => {
    if (!pages || pages.length === 0) return [];
    const last = pages[pages.length - 1];
    const loaded = (key: "deliveries" | "queued"): LoadedSource => ({
      rows: pages.flatMap(page => page[key]),
      more: last.next[key] !== null,
    });
    return mergeNewestFirst([loaded("deliveries"), loaded("queued")]);
  }, [pages]);

  return {
    rows,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => {
      void query.fetchNextPage();
    },
    refetch: () => {
      void query.refetch();
    },
  };
}

/**
 * Whether queued email is overdue because the jobs trigger is not running,
 * asked again every minute while the hub is open.
 */
export function useQueuedEmailOverdue(
  options: { enabled?: boolean } = {}
): UseQueryResult<QueuedEmailOverdue, Error> {
  return useQuery<QueuedEmailOverdue, Error>({
    queryKey: emailActivityKeys.overdue(),
    queryFn: getQueuedEmailOverdue,
    refetchInterval: OVERDUE_POLL_MS,
    enabled: options.enabled ?? true,
  });
}
