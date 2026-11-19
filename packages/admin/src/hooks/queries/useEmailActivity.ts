/**
 * The Email hub's Activity reads, as TanStack Query hooks.
 *
 * `useEmailActivity` answers the server's merged Activity, newest first: queued
 * email and the deliveries of sends that were not queued, under one cursor
 * and one set of filters, a page at a time.
 *
 * Query keys:
 * - `["emailActivity"]`, the base key
 * - `["emailActivity", "list", query, window]`, one filtered list
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
  activityQuery,
  activityRow,
  holdsUnsettledQueued,
  isUnsettled,
  windowStart,
  type ActivityFilter,
  type ActivityRow,
  type TimeWindow,
} from "@admin/components/features/email-hub/activity/activity-model";
import {
  getDeliveryDetail,
  getQueuedEmailDetail,
  getQueuedEmailOverdue,
  listActivity,
  type DeliveryDetail,
  type QueuedEmailDetail,
  type QueuedEmailOverdue,
} from "@admin/services/emailActivityApi";

/** How many rows each page answers. */
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

const emailActivityKeys = {
  all: () => ["emailActivity"] as const,
  list: (query: ReturnType<typeof activityQuery>, window: TimeWindow) =>
    [...emailActivityKeys.all(), "list", query, window] as const,
  overdue: () => [...emailActivityKeys.all(), "overdue"] as const,
  detail: (source: "delivery" | "queued", id: string) =>
    [...emailActivityKeys.all(), "detail", source, id] as const,
};

/**
 * Where a page after the first starts: the cursor the page before it gave,
 * and the window's start that page was read with, so paging further never
 * moves the window under rows already shown.
 */
interface ActivityCursor {
  before: string;
  from: string;
}

/** One page: its rows, where the next starts, and the window it was read in. */
interface ActivityPage {
  rows: ActivityRow[];
  next: string | null;
  from: string;
}

/**
 * One page of the merged Activity. The first page measures its window's
 * start when it is read, so each refresh, which reads the first page again,
 * rolls the window forward; a later page keeps the start its first page had.
 */
async function readActivityPage(
  query: ReturnType<typeof activityQuery>,
  window: TimeWindow,
  cursor: ActivityCursor | null
): Promise<ActivityPage> {
  const from = cursor?.from ?? windowStart(window, new Date());
  const page = await listActivity({
    ...query,
    from,
    ...(cursor ? { before: cursor.before } : {}),
    limit: ACTIVITY_PAGE_SIZE,
  });
  return {
    rows: page.items.map(activityRow),
    next: page.meta.nextBefore ?? null,
    from,
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
  return pages.some(page => holdsUnsettledQueued(page.rows))
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
 * The merged Activity, newest first, narrowed by `filter`. Its window ends
 * when its first page is read, and moves forward with each refresh.
 */
export function useEmailActivity(
  filter: ActivityFilter,
  options: { enabled?: boolean } = {}
): EmailActivityResult {
  const filterKey = JSON.stringify(activityQuery(filter));
  // Read back from the key, so the memo depends on the filter's value and
  // not on a new object with the same value each render.
  const query = useMemo(
    () => JSON.parse(filterKey) as ReturnType<typeof activityQuery>,
    [filterKey]
  );
  const window = filter.window;

  const read = useInfiniteQuery<
    ActivityPage,
    Error,
    InfiniteData<ActivityPage, ActivityCursor | null>,
    ReturnType<typeof emailActivityKeys.list>,
    ActivityCursor | null
  >({
    queryKey: emailActivityKeys.list(query, window),
    initialPageParam: null,
    queryFn: ({ pageParam }) => readActivityPage(query, window, pageParam),
    getNextPageParam: last =>
      last.next === null ? undefined : { before: last.next, from: last.from },
    enabled: options.enabled ?? true,
    // Read again sooner while a loaded queued email can still change by
    // itself, and every minute otherwise, for email sent or queued since.
    // Only while one page is loaded: a refetch reads every loaded page again,
    // so a reader who loaded more keeps what they loaded until they reload.
    refetchInterval: current => refreshEvery(current.state.data?.pages),
    refetchOnWindowFocus: current =>
      (current.state.data?.pages.length ?? 0) <= 1,
  });

  const pages = read.data?.pages;
  const rows = useMemo(() => (pages ?? []).flatMap(page => page.rows), [pages]);

  return {
    rows,
    isLoading: read.isLoading,
    isError: read.isError,
    error: read.error,
    hasMore: read.hasNextPage,
    isLoadingMore: read.isFetchingNextPage,
    loadMore: () => {
      void read.fetchNextPage();
    },
    refetch: () => {
      void read.refetch();
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
