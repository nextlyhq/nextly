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
  type InfiniteData,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useMemo } from "react";

import {
  deliveryRow,
  holdsUnsettledQueued,
  isUnsettled,
  mergeNewestFirst,
  queuedRow,
  sourcesFor,
  type ActivityFilter,
  type ActivityRow,
  type LoadedSource,
} from "@admin/components/features/email-hub/activity/activity-model";
import type { ListResponse } from "@admin/lib/api/response-types";
import {
  getDeliveryDetail,
  getQueuedEmailDetail,
  getQueuedEmailOverdue,
  listDeliveryActivity,
  listQueuedEmailActivity,
  type DeliveryDetail,
  type QueuedEmailDetail,
  type QueuedEmailOverdue,
} from "@admin/services/emailActivityApi";

/** How many records each list answers per page. */
const ACTIVITY_PAGE_SIZE = 50;

/**
 * How often a list holding a queued email that can still change is read
 * again, so its state, attempts and due time stay true while the tab is open.
 */
const UNSETTLED_POLL_MS = 30_000;

/**
 * How often a list of settled rows is read again, so email sent or queued
 * since appears while the tab stays open, however quiet the list was.
 */
const SETTLED_POLL_MS = 60_000;

/** How often the overdue check is asked again while the hub is open. */
const OVERDUE_POLL_MS = 60_000;

type Sources = ReturnType<typeof sourcesFor>;

const emailActivityKeys = {
  all: () => ["emailActivity"] as const,
  list: (sources: Sources) =>
    [...emailActivityKeys.all(), "list", sources] as const,
  overdue: () => [...emailActivityKeys.all(), "overdue"] as const,
  detail: (source: "delivery" | "queued", id: string) =>
    [...emailActivityKeys.all(), "detail", source, id] as const,
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

/**
 * One list's next page, or `null` for a list the filters leave out or that
 * has nothing more.
 */
function readListPage<Q extends object, T>(
  query: Q | null,
  cursor: string | undefined | null,
  list: (
    query: Q & { before?: string; limit: number }
  ) => Promise<ListResponse<T>>
): Promise<ListResponse<T> | null> {
  if (query === null || cursor === null) return Promise.resolve(null);
  return list({
    ...query,
    ...(cursor ? { before: cursor } : {}),
    limit: ACTIVITY_PAGE_SIZE,
  });
}

/** A page's rows as the list shows them, and where that list goes on from. */
function rowsOf<T>(
  page: ListResponse<T> | null,
  toRow: (record: T) => ActivityRow
): { rows: ActivityRow[]; next: string | null } {
  if (page === null) return { rows: [], next: null };
  return { rows: page.items.map(toRow), next: page.meta.nextBefore ?? null };
}

/** The next page of every list that has more, read together. */
async function readActivityPage(
  sources: Sources,
  cursor: ActivityCursor
): Promise<ActivityPage> {
  const [deliveryPage, queuedPage] = await Promise.all([
    readListPage(sources.deliveries, cursor.deliveries, listDeliveryActivity),
    readListPage(sources.queued, cursor.queued, listQueuedEmailActivity),
  ]);
  const deliveries = rowsOf(deliveryPage, deliveryRow);
  const queued = rowsOf(queuedPage, queuedRow);
  return {
    deliveries: deliveries.rows,
    queued: queued.rows,
    next: { deliveries: deliveries.next, queued: queued.next },
  };
}

/**
 * How often the list is read again: never once more than one page is
 * loaded, since each read again reads every loaded page; otherwise sooner
 * while a queued email on it can still change, and every minute if not.
 */
function refreshEvery(
  pages: readonly ActivityPage[] | undefined
): number | false {
  if (!pages || pages.length > 1) return false;
  return pages.some(page => holdsUnsettledQueued(page.queued))
    ? UNSETTLED_POLL_MS
    : SETTLED_POLL_MS;
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

  const firstPage: ActivityCursor = {
    deliveries: sources.deliveries ? undefined : null,
    queued: sources.queued ? undefined : null,
  };
  const query = useInfiniteQuery<
    ActivityPage,
    Error,
    InfiniteData<ActivityPage, ActivityCursor>,
    ReturnType<typeof emailActivityKeys.list>,
    ActivityCursor
  >({
    queryKey: emailActivityKeys.list(sources),
    initialPageParam: firstPage,
    queryFn: ({ pageParam }) => readActivityPage(sources, pageParam),
    getNextPageParam: last =>
      last.next.deliveries === null && last.next.queued === null
        ? undefined
        : last.next,
    enabled: options.enabled ?? true,
    // Read again sooner while a loaded queued email can still change by
    // itself, and every minute otherwise, for email sent or queued since.
    // Only while one page is loaded: a refetch reads every loaded page again,
    // so a reader who loaded more keeps what they loaded until they reload.
    refetchInterval: current => refreshEvery(current.state.data?.pages),
    refetchOnWindowFocus: current =>
      (current.state.data?.pages.length ?? 0) <= 1,
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

/** Which sheet is open: a delivery record, or a queued email, by id. */
export interface OpenActivity {
  source: "delivery" | "queued";
  id: string;
}

/** A sheet's detail, as the server answers it for that kind of row. */
export type ActivityDetail =
  | { source: "delivery"; detail: DeliveryDetail }
  | { source: "queued"; detail: QueuedEmailDetail };

/**
 * The detail of the row whose sheet is open, read only while one is. A
 * queued email that can still change by itself is read again as the list
 * is, so its state and timeline stay true while the sheet stays open.
 */
export function useActivityDetail(
  open: OpenActivity | null
): UseQueryResult<ActivityDetail, Error> {
  return useQuery<ActivityDetail, Error>({
    queryKey: open
      ? emailActivityKeys.detail(open.source, open.id)
      : [...emailActivityKeys.all(), "detail", "none"],
    queryFn: async () => {
      if (!open) throw new Error("No sheet is open.");
      return open.source === "delivery"
        ? { source: "delivery", detail: await getDeliveryDetail(open.id) }
        : { source: "queued", detail: await getQueuedEmailDetail(open.id) };
    },
    enabled: open !== null,
    // Never fresh, so a sheet reads its email again whenever it opens, also
    // when the same sheet closes and reopens on a row without remounting: a
    // cached detail may say an email is still retrying after the list has
    // seen it settle.
    staleTime: 0,
    refetchInterval: current => {
      const data = current.state.data;
      return data?.source === "queued" && isUnsettled(data.detail.state)
        ? UNSETTLED_POLL_MS
        : false;
    },
  });
}
