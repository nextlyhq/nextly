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
  searchActivityByAddress,
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
  // A search is keyed by the screen's count of searches alone, never the
  // address, so the address is in no cache key a devtool or a log could show,
  // and nothing but a new search, never a filter edit, makes a new key.
  search: (searchId: number) =>
    [...emailActivityKeys.all(), "search", searchId] as const,
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

/**
 * One page: its rows, where the next starts, the window it was read in, and,
 * for a search by address, the server's notice of what a search can't reach.
 */
interface ActivityPage {
  rows: ActivityRow[];
  next: string | null;
  from: string;
  notice: string | null;
}

/**
 * A search by address the screen has made: its count, the address, and the
 * filters it was made with, so it reads only what was asked when it was made.
 */
export interface AddressSearchRequest {
  /** Bumped by each search, so the same address searched again reads again. */
  id: number;
  address: string;
  filter: ActivityFilter;
}

/**
 * One page of the merged Activity. The first page measures its window's
 * start when it is read, so each refresh, which reads the first page again,
 * rolls the window forward; a later page keeps the start its first page had.
 */
async function readActivityPage(
  query: ReturnType<typeof activityQuery>,
  window: TimeWindow,
  cursor: ActivityCursor | null,
  address: string | undefined
): Promise<ActivityPage> {
  const from = cursor?.from ?? windowStart(window, new Date());
  const asked = {
    ...query,
    from,
    ...(cursor ? { before: cursor.before } : {}),
    limit: ACTIVITY_PAGE_SIZE,
  };
  if (address === undefined) {
    const page = await listActivity(asked);
    return {
      rows: page.items.map(activityRow),
      next: page.meta.nextBefore ?? null,
      from,
      notice: null,
    };
  }
  const page = await searchActivityByAddress({ ...asked, address });
  return {
    rows: page.items.map(activityRow),
    next: page.meta.nextBefore ?? null,
    from,
    notice: page.meta.notice,
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
  /** A search's notice of the records it can't reach; null for the list. */
  notice: string | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  refetch: () => void;
}

/**
 * The merged Activity, newest first, narrowed by `filter`, or, given a
 * `search`, only what went to that one exact address. The list's window ends
 * when its first page is read, and moves forward with each refresh.
 *
 * A search is read only when asked: every read of one is recorded as a
 * search in the activity log, so it never polls, refetches on focus or
 * retries by itself, and its rows are dropped from the cache once nothing
 * shows them.
 */
export function useEmailActivity(
  filter: ActivityFilter,
  options: { enabled?: boolean; search?: AddressSearchRequest } = {}
): EmailActivityResult {
  const search = options.search;
  // A search reads with the filters it was made with: every read of one is
  // recorded, so a filter edit alone never searches.
  const asked = search?.filter ?? filter;
  const filterKey = JSON.stringify(activityQuery(asked));
  // Read back from the key, so the memo depends on the filter's value and
  // not on a new object with the same value each render.
  const query = useMemo(
    () => JSON.parse(filterKey) as ReturnType<typeof activityQuery>,
    [filterKey]
  );
  const window = asked.window;

  const read = useInfiniteQuery<
    ActivityPage,
    Error,
    InfiniteData<ActivityPage, ActivityCursor | null>,
    readonly unknown[],
    ActivityCursor | null
  >({
    queryKey: search
      ? emailActivityKeys.search(search.id)
      : emailActivityKeys.list(query, window),
    initialPageParam: null,
    queryFn: ({ pageParam }) =>
      readActivityPage(query, window, pageParam, search?.address),
    getNextPageParam: last =>
      last.next === null ? undefined : { before: last.next, from: last.from },
    enabled: options.enabled ?? true,
    // Read again sooner while a loaded queued email can still change by
    // itself, and every minute otherwise, for email sent or queued since.
    // Only while one page is loaded: a refetch reads every loaded page again,
    // so a reader who loaded more keeps what they loaded until they reload.
    // A search never reads again by itself: each read is a recorded search.
    refetchInterval: current =>
      search ? false : refreshEvery(current.state.data?.pages),
    refetchOnWindowFocus: current =>
      !search && (current.state.data?.pages.length ?? 0) <= 1,
    refetchOnReconnect: !search,
    refetchOnMount: !search,
    ...(search ? { retry: false, staleTime: Infinity, gcTime: 0 } : {}),
  });

  const pages = read.data?.pages;
  const rows = useMemo(() => (pages ?? []).flatMap(page => page.rows), [pages]);

  return {
    rows,
    notice: pages?.[0]?.notice ?? null,
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
