"use client";

/**
 * Release query hooks.
 *
 * ## Query keys
 *
 * - `["releases"]` — every release query, the invalidation root
 * - `["releases", "list", params]` — one window
 * - `["releases", "calendar", params]` — one calendar window, in one zone
 * - `["releases", "every-id", params]` — every id a list read matches
 * - `["releases", "detail", id]` — one release
 * - `["releases", "members", id]` — its contents
 * - `["releases", "readiness", id]` — what its checks say now
 * - `["releases", "history", id]` — its history, newest first
 * - `["releases", "documents", id, scope]` — its documents' titles
 *
 * ## Why every mutation invalidates the LIST as well as the detail
 *
 * A release's list row shows its state and instant, and scheduling changes
 * both. Invalidating only the detail leaves the list showing "draft" for a
 * release the editor has just committed to Friday — and the list is where they
 * look to confirm it. Membership counts the same way once the list shows size.
 *
 * @module hooks/queries/useReleases
 */

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { entryTitleValue } from "@admin/components/features/entries/entry-title";
import { toast } from "@admin/components/ui";
import { collectionApi } from "@admin/services/collectionApi";
import { entryApi } from "@admin/services/entryApi";
import {
  addReleaseMember,
  cancelRelease,
  changeReleaseMemberAction,
  createRelease,
  deleteRelease,
  fetchRelease,
  fetchReleaseBlockers,
  fetchReleaseCalendar,
  fetchReleaseHistory,
  fetchReleaseMembers,
  fetchReleaseReadiness,
  fetchReleasesReadiness,
  fetchReleases,
  publishReleaseNow,
  removeReleaseMember,
  scheduleRelease,
  updateRelease,
} from "@admin/services/releaseApi";
import { singleApi } from "@admin/services/singleApi";
import {
  RELEASE_LIST_TABS,
  type AddReleaseMemberPayload,
  type CreateReleasePayload,
  type ReleaseCalendarParams,
  type ReleaseCalendarRead,
  type ReleaseDocumentInfo,
  type ReleaseDocumentRef,
  type ReleaseKind,
  type ReleaseListParams,
  type ReleaseListTab,
  type ReleaseMember,
  type ReleaseMemberAction,
  type ReleaseScopeNames,
  type ScheduleReleasePayload,
  type UpdateReleasePayload,
} from "@admin/types/releases";

export const releaseKeys = {
  all: () => ["releases"] as const,
  list: (params: ReleaseListParams) => ["releases", "list", params] as const,
  calendar: (params: ReleaseCalendarParams) =>
    ["releases", "calendar", params] as const,
  everyId: (params: ReleaseListParams) =>
    ["releases", "every-id", params] as const,
  detail: (id: string) => ["releases", "detail", id] as const,
  members: (id: string) => ["releases", "members", id] as const,
  blockers: (id: string) => ["releases", "blockers", id] as const,
  readinessOf: (id: string) => ["releases", "readiness", id] as const,
  history: (id: string) => ["releases", "history", id] as const,
  created: (id: string) => ["releases", "history", id, "created"] as const,
  documents: (id: string, scopeKind: string, scopeSlug: string, ids: string) =>
    ["releases", "documents", id, scopeKind, scopeSlug, ids] as const,
  readiness: (ids: readonly string[], listReadAt: number) =>
    ["release-page-readiness", [...ids], listReadAt] as const,
};

export function useReleases(params: ReleaseListParams = {}, enabled = true) {
  return useQuery({
    queryKey: releaseKeys.list(params),
    queryFn: () => fetchReleases(params),
    // A caller can decline to ask. `/api/releases` is gated, so a component
    // that will not render its result — because the reader lacks the grant, or
    // because the surface is closed — would otherwise issue a request whose
    // only outcome is a 403 in everyone's network log.
    enabled,
    // Re-asked on the SAME two schedules as the banner and the detail row, and
    // for the same reason: a scheduled release settles by itself, and nothing
    // about that reaches this browser. A list or a calendar left open across an
    // instant would otherwise go on showing a release as upcoming after the
    // drain published or stopped it — and on the calendar that means a day
    // keeps a count for a launch that has already happened.
    //
    // Two SPEEDS rather than an interval and a stop: a condition that halts
    // polling can be satisfied by a wrong answer, and a stale row read once as
    // settled would then never be corrected.
    refetchInterval: data =>
      hasPendingRelease(data.state.data)
        ? PENDING_RELEASE_POLL_MS
        : NO_RELEASE_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * One page of one tab of the release list.
 *
 * The list's own read rather than {@link useReleases}, for one reason: while
 * the next page or search of the SAME tab is being fetched it keeps showing
 * the rows it has, so the table and its pager hold still instead of
 * collapsing to a loading row on every page turn. Never across tabs: a tab
 * showing another tab's releases, even for a moment, says something untrue
 * about where they are, and offers a pager for a list it is not showing.
 * Polled on the same two speeds as the rest of the releases screens, and for
 * the same reason.
 */
export function useReleaseListPage(params: ReleaseListParams) {
  return useQuery({
    queryKey: releaseKeys.list(params),
    queryFn: () => fetchReleases(params),
    placeholderData: (previous, previousQuery) =>
      sameTab(previousQuery?.queryKey[2], params) ? previous : undefined,
    refetchInterval: data =>
      hasPendingRelease(data.state.data)
        ? PENDING_RELEASE_POLL_MS
        : NO_RELEASE_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * Whether two list reads are of the same tab and the same part of it, and of
 * the same calendar day.
 *
 * The day counts as a part: a day's list kept on screen while another day's
 * loads would show one day's releases under the next day's heading.
 */
function sameTab(
  previous: ReleaseListParams | undefined,
  next: ReleaseListParams
): boolean {
  return (
    previous !== undefined &&
    previous.tab === next.tab &&
    previous.reason === next.reason &&
    previous.day?.date === next.day?.date &&
    previous.day?.timezone === next.day?.timezone
  );
}

/**
 * The calendar of one window of days in one zone, as the server counts it.
 *
 * Inside the `releases` root, so every release write refreshes it as it
 * refreshes the list. Polled on the list's two speeds, and for the list's
 * reason: a scheduled release runs by itself, and a day left open across its
 * moment would otherwise go on counting it as scheduled.
 *
 * No placeholder while another window loads. The previous answer is of other
 * days, or of the same dates in another zone, and drawing it under the new
 * grid would put releases on days they are not on.
 */
export function useReleaseCalendar(params: ReleaseCalendarParams) {
  return useQuery({
    queryKey: releaseKeys.calendar(params),
    queryFn: () => fetchReleaseCalendar(params),
    refetchInterval: data =>
      calendarHasPendingRelease(data.state.data)
        ? PENDING_RELEASE_POLL_MS
        : NO_RELEASE_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * The largest page the list route serves, which is the page this asks for
 * when it has to read a listing in full.
 */
const LIST_PAGE_CEILING = 200;

/**
 * The ids of every release one list read matches, read a page at a time
 * until the server says there are no more.
 *
 * For a question that needs the whole answer rather than a page of it, such
 * as which releases in a calendar window are overdue: a capped read would
 * leave the rest looking like something they are not. Bounded by the query
 * itself, and stopped by an empty page as well as by `hasNext`, so a server
 * that kept saying "more" could not hold it in a loop.
 */
async function readEveryReleaseId(
  params: ReleaseListParams
): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; ; page += 1) {
    const answer = await fetchReleases({
      ...params,
      page,
      limit: LIST_PAGE_CEILING,
    });
    ids.push(...answer.items.map(release => release.id));
    if (!answer.meta.hasNext || answer.items.length === 0) return ids;
  }
}

/**
 * Every release one list read matches, by id, however many pages it runs to.
 *
 * Inside the `releases` root, so every release write refreshes it, and polled
 * on the list's pending speed: the answer is about releases still waiting.
 */
export function useEveryReleaseId(params: ReleaseListParams, enabled = true) {
  return useQuery({
    queryKey: releaseKeys.everyId(params),
    queryFn: () => readEveryReleaseId(params),
    enabled,
    refetchInterval: PENDING_RELEASE_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/** Whether any day of a calendar answer still holds a scheduled release. */
function calendarHasPendingRelease(
  data: ReleaseCalendarRead | undefined
): boolean {
  return (data?.days ?? []).some(day => day.counts.scheduled > 0);
}

/**
 * How many releases each tab holds, under the same search and filter as the
 * list.
 *
 * Read from each tab's own list total, asked for one row, so a count is
 * always the number the tab would page through: the server applies the same
 * rule to both, and there is no second way of counting here to disagree with
 * it. The current tab's count is a separate request from its page for the
 * same reason the page is polled: a count shown beside a tab must not depend
 * on which tab happens to be open.
 */
export function useReleaseTabCounts(filters: {
  search?: string;
  kind?: ReleaseKind;
}) {
  const results = useQueries({
    queries: RELEASE_LIST_TABS.map(tab => {
      const params: ReleaseListParams = {
        tab,
        limit: 1,
        ...(filters.search ? { search: filters.search } : {}),
        ...(filters.kind ? { kind: filters.kind } : {}),
      };
      return {
        queryKey: releaseKeys.list(params),
        queryFn: () => fetchReleases(params),
        placeholderData: keepPreviousData,
        // A release moves between tabs on its own when its instant passes,
        // so the counts are re-asked on the list's pending speed.
        refetchInterval: PENDING_RELEASE_POLL_MS,
        refetchOnWindowFocus: true,
      };
    }),
  });
  const counts = {} as Record<ReleaseListTab, number | undefined>;
  RELEASE_LIST_TABS.forEach((tab, index) => {
    counts[tab] = results[index]?.data?.meta.total;
  });
  return {
    counts,
    isPending: results.some(result => result.isPending),
    isError: results.some(result => result.isError),
    /** Ask every tab's count again, as a retry after a failure. */
    refetch: () => {
      for (const result of results) void result.refetch();
    },
  };
}

/**
 * What the checks say about each release on a page, in one request.
 *
 * Asked again every time the list it describes is read again: `listReadAt` is
 * that list's own read time, so the list's poll, or the refresh after an
 * action, is what refreshes this too. A document can become invalid while the
 * page stays open, and a release must not go on reading "Ready" after it
 * stopped being so. No timer of its own: it follows the list's.
 *
 * Keyed outside the `releases` root for the same reason: invalidating that
 * root re-reads the list, which moves `listReadAt`, which asks this once.
 * Inside the root it would be asked twice. The previous answer stays on
 * screen while the next one loads, so the column does not flicker on a poll.
 * Its own key rather than the blockers', because the schedule dialog's
 * preflight must never be answered from a cache, and this may be.
 */
export function useReleasesReadiness(
  releaseIds: readonly string[],
  listReadAt: number
) {
  return useQuery({
    queryKey: releaseKeys.readiness(releaseIds, listReadAt),
    queryFn: () => fetchReleasesReadiness(releaseIds),
    enabled: releaseIds.length > 0,
    placeholderData: keepPreviousData,
    // Each list read makes a new key; one only the last read uses need not
    // be kept long.
    gcTime: 60_000,
  });
}

/**
 * The scheduled releases holding one document, soonest first.
 *
 * A narrowing of the same list, so it shares the list's cache key and is
 * invalidated by every release write — adding this document to a release
 * refreshes the banner without the banner knowing that happened.
 */
export function useReleasesContaining(
  document: ReleaseDocumentRef | undefined,
  enabled = true
) {
  // The route's ceiling rather than its default of 50. A document in more
  // than fifty scheduled releases is implausible, and asking for the ceiling
  // costs nothing when the real answer is one or two — but the banner presents
  // the rows as a SEQUENCE whose last member is the document's final state, and
  // a silently truncated sequence would present an incomplete answer as a
  // complete one.
  const params: ReleaseListParams = document
    ? { containing: document, limit: 200 }
    : {};
  const query = useQuery({
    queryKey: releaseKeys.list(params),
    queryFn: () => fetchReleases(params),
    // Never asked without a complete reference: the route refuses a partial
    // one, and a 404-shaped error in the console under every document editor
    // is a poor way to say "this document has no id yet".
    enabled: enabled && Boolean(document),
    // Re-asked on TWO schedules, because two different things change this
    // answer and neither runs an admin mutation that would invalidate it.
    //
    // A pending release is resolved by the background drain, so an editor
    // holding the page across the instant would otherwise keep reading that a
    // release is coming, and that saves are still included, after it has run.
    //
    // An EMPTY answer changes too, and that is the case a pending-only interval
    // misses: another administrator schedules this document from their own
    // browser, which invalidates their QueryClient and not this one. The first
    // editor then goes on saving, indefinitely, without learning the document
    // has an automatic pending change. Polled more slowly rather than not at
    // all — nearly every document is in no release, and the answer is worth one
    // request every few minutes rather than one a minute.
    refetchInterval: data =>
      hasPendingRelease(data.state.data)
        ? PENDING_RELEASE_POLL_MS
        : NO_RELEASE_POLL_MS,
    // And on return to the tab, which is when an editor actually resumes
    // typing. The global provider disables this everywhere; here the answer is
    // a safety signal rather than a view of data the reader already has, and
    // coming back to a stale one is exactly the moment it matters.
    refetchOnWindowFocus: true,
  });
  return query;
}

/**
 * How often to re-ask while a release is still ahead of this document.
 *
 * A minute. The banner is a safety signal rather than a clock, so the cost of
 * being a minute late is that an editor briefly reads a promise that has just
 * become moot; the cost of polling harder is a request per document editor per
 * few seconds, for a page that mostly sits open.
 */
const PENDING_RELEASE_POLL_MS = 60_000;

/**
 * How often to re-ask when this document is in no release at all.
 *
 * Five minutes. Nearly every document is in this state, so the cost is paid on
 * every open editor — but the answer is not static: somebody else can schedule
 * this document at any moment, and nothing they do reaches this browser.
 */
const NO_RELEASE_POLL_MS = 300_000;

/** Whether anything in this answer is still waiting to happen. */
function hasPendingRelease(
  data: { items: { state: string }[] } | undefined
): boolean {
  return (data?.items ?? []).some(release => release.state === "scheduled");
}

export function useRelease(id: string | undefined) {
  return useQuery({
    queryKey: releaseKeys.detail(id ?? ""),
    queryFn: () => fetchRelease(id as string),
    // Not fetched without an id: the detail route renders before its parameter
    // resolves, and a request for `/releases/undefined` is a 404 the editor
    // would see as "this release is gone".
    enabled: Boolean(id),
    // Re-asked on the SAME two schedules as the document banner, and for the
    // same reason: a scheduled release settles by itself, and nothing about
    // that reaches this browser.
    //
    // This page is the one somebody watches a launch on. Held open across the
    // instant, it would otherwise go on showing `scheduled` however the drain
    // resolved it — no interval, and the provider disables focus refetching
    // globally, so nothing would ask again until an unrelated mutation or a
    // remount. A `staleTime` does not help: it governs whether a NEW subscriber
    // refetches, and never initiates a request for a query already mounted. So
    // the person most likely to be watching is the last to learn it stopped.
    //
    // The blockers travel on this response, so refreshing it is also what
    // replaces "scheduled" with the list of what has to be fixed.
    //
    // Two SPEEDS rather than an interval and a stop, deliberately. A condition
    // that halts polling can be satisfied by a wrong answer — a stale row read
    // once as settled would then never be corrected, and the page would keep
    // that claim for as long as it stayed open. Slowing down cannot do that.
    refetchInterval: data =>
      data.state.data?.state === "scheduled"
        ? PENDING_RELEASE_POLL_MS
        : NO_RELEASE_POLL_MS,
    // And on return to the tab, which is when somebody actually looks.
    refetchOnWindowFocus: true,
  });
}

/**
 * What stands between a release and its instant — the preflight.
 *
 * Asked only when somebody is about to commit to one, which is why it is
 * `enabled`-gated rather than fetched with the detail: the answer costs an
 * identity lookup over every member, and the overwhelming majority of reads do
 * not need it to be told that nothing is wrong.
 *
 * NOT cached across the dialog closing. A blocker is fixed by editing a
 * document or removing a member, both of which happen elsewhere — so a stale
 * "nothing is blocking this" is exactly the answer that would let somebody
 * schedule a launch that cannot run.
 */
export function useReleaseBlockers(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: releaseKeys.blockers(id ?? ""),
    queryFn: () => fetchReleaseBlockers(id as string),
    enabled: enabled && Boolean(id),
    staleTime: 0,
  });
}

export function useReleaseMembers(id: string | undefined) {
  return useQuery({
    queryKey: releaseKeys.members(id ?? ""),
    queryFn: () => fetchReleaseMembers(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Refresh everything a release write can have changed.
 *
 * Deliberately coarse. A release is small and read rarely, so the cost of
 * refetching a window is nothing against the cost of an editor reading a stale
 * schedule and concluding their release did not take.
 */
function useRefreshRelease() {
  const queryClient = useQueryClient();
  return (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: releaseKeys.all() });
    if (id) {
      void queryClient.invalidateQueries({ queryKey: releaseKeys.detail(id) });
      void queryClient.invalidateQueries({ queryKey: releaseKeys.members(id) });
    }
  };
}

/**
 * Why every release mutation below sets `retry: false`.
 *
 * The app-wide `QueryProvider` retries failed mutations twice, which is right
 * for an idempotent write and wrong for every write here. None of these
 * endpoints takes an idempotency key, so a request that COMMITS and then loses
 * its response is indistinguishable from one that never arrived: `create`
 * repeated twice makes three releases, and `addMember` three membership rows.
 *
 * The state moves are safer but not silent — a retried `schedule` or `cancel`
 * lands on a release already in the target state and the fence answers with a
 * conflict, so the editor is told their action failed when it took. Both
 * failure modes are worse than the one retrying exists to prevent.
 */
const NO_RETRY = { retry: false } as const;

export function useCreateRelease() {
  const refresh = useRefreshRelease();
  return useMutation({
    ...NO_RETRY,
    mutationFn: (payload: CreateReleasePayload) => createRelease(payload),
    onSuccess: result => {
      refresh(result.item.id);
      toast.success("Release created.");
    },
  });
}

export function useScheduleRelease(id: string) {
  const refresh = useRefreshRelease();
  return useMutation({
    ...NO_RETRY,
    mutationFn: (payload: ScheduleReleasePayload) =>
      scheduleRelease(id, payload),
    onSuccess: () => {
      refresh(id);
      toast.success("Release scheduled.");
    },
  });
}

export function useCancelRelease(id: string) {
  const refresh = useRefreshRelease();
  return useMutation({
    ...NO_RETRY,
    mutationFn: () => cancelRelease(id),
    onSuccess: () => {
      refresh(id);
      toast.success("Release cancelled.");
    },
  });
}

export function useAddReleaseMember(releaseId: string) {
  const refresh = useRefreshRelease();
  return useMutation({
    ...NO_RETRY,
    mutationFn: (payload: AddReleaseMemberPayload) =>
      addReleaseMember(releaseId, payload),
    onSuccess: () => {
      refresh(releaseId);
      toast.success("Added to release.");
    },
  });
}

export function useRemoveReleaseMember(releaseId: string) {
  const refresh = useRefreshRelease();
  return useMutation({
    ...NO_RETRY,
    // The release id travels with the member id: the server refuses a member
    // belonging to another release, so a stale view cannot edit one the editor
    // never opened.
    mutationFn: (memberId: string) => removeReleaseMember(releaseId, memberId),
    onSuccess: () => {
      refresh(releaseId);
      toast.success("Removed from release.");
    },
  });
}

export function usePublishReleaseNow(id: string) {
  const refresh = useRefreshRelease();
  return useMutation({
    ...NO_RETRY,
    mutationFn: () => publishReleaseNow(id),
    onSuccess: result => {
      refresh(id);
      // The server's own sentence: a run can publish everything, stop
      // part-way, or leave the rest to the runner, and only it knows which.
      toast.success(result.message ?? "Release published.");
    },
  });
}

export function useDeleteRelease(id: string) {
  const queryClient = useQueryClient();
  const refresh = useRefreshRelease();
  return useMutation({
    ...NO_RETRY,
    mutationFn: () => deleteRelease(id),
    onSuccess: () => {
      // Removed rather than refetched: the release is gone, and asking for it
      // again would only answer 404.
      queryClient.removeQueries({ queryKey: releaseKeys.detail(id) });
      refresh();
      toast.success("Release deleted.");
    },
  });
}

/**
 * What the checks say about one release's documents now, for its page.
 *
 * Asked again on the page's own schedule and on return to the tab, so a
 * problem fixed in another tab reads as fixed without the reader asking, and
 * after every release write through the `releases` root. The previous answer
 * stays on screen while the next one loads. Not asked for a release that has
 * run or been cancelled: it has nothing left to get ready.
 */
export function useReleaseReadiness(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: releaseKeys.readinessOf(id ?? ""),
    queryFn: () => fetchReleaseReadiness(id as string),
    enabled: enabled && Boolean(id),
    placeholderData: keepPreviousData,
    refetchInterval: PENDING_RELEASE_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/** How many history events a page of the release's history asks for. */
const HISTORY_PAGE = 25;

/**
 * A release's history, newest first, a page at a time: each page asks for
 * the events older than the last one shown.
 */
export function useReleaseHistory(id: string | undefined) {
  return useInfiniteQuery({
    queryKey: releaseKeys.history(id ?? ""),
    queryFn: ({ pageParam }) =>
      fetchReleaseHistory(id as string, {
        limit: HISTORY_PAGE,
        ...(pageParam ? { before: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: last =>
      last.meta.hasNext ? last.items[last.items.length - 1]?.id : undefined,
    enabled: Boolean(id),
    refetchOnWindowFocus: true,
  });
}

/**
 * The event that created a release, read on its own: the history pages from
 * the newest, and a long history would otherwise keep its owner off screen.
 */
export function useReleaseCreation(id: string | undefined) {
  return useQuery({
    queryKey: releaseKeys.created(id ?? ""),
    queryFn: async () =>
      (
        await fetchReleaseHistory(id as string, {
          kind: "release-created",
          limit: 1,
        })
      ).items[0] ?? null,
    enabled: Boolean(id),
  });
}

/** The ids a collection read asks for at once. */
const DOCUMENTS_PER_READ = 100;

/** One collection's or Single's documents in a release, as one read answers them. */
interface ScopeDocuments {
  names: ReleaseScopeNames;
  documents: Map<string, ReleaseDocumentInfo>;
}

/** A document's status, where the read gave a recognised one. */
function statusOf(value: unknown): ReleaseDocumentInfo["status"] {
  return value === "draft" || value === "published" ? value : null;
}

/** One document's row, as the release page names and places it. */
function documentInfoOf(
  row: Record<string, unknown>,
  useAsTitle: string | undefined
): ReleaseDocumentInfo {
  return {
    title: entryTitleValue(row, useAsTitle) ?? null,
    status: statusOf(row.status),
    everPublished:
      "firstPublishedAt" in row ? row.firstPublishedAt != null : null,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
  };
}

/**
 * A collection's documents, by id: its names, then the documents in batches,
 * as the reader may read them. A list read answers with each document's
 * stored row, so a document is named by the title it has now rather than one
 * an unpublished draft gives it; reading every draft would be a request per
 * document.
 */
async function readCollectionDocuments(
  slug: string,
  ids: readonly string[]
): Promise<ScopeDocuments> {
  const collection = await collectionApi.get(slug);
  const useAsTitle = collection.admin?.useAsTitle;
  const documents = new Map<string, ReleaseDocumentInfo>();
  for (let from = 0; from < ids.length; from += DOCUMENTS_PER_READ) {
    const batch = ids.slice(from, from + DOCUMENTS_PER_READ);
    const found = await entryApi.find(slug, {
      where: { id: { in: batch } },
      limit: batch.length,
      depth: 0,
    });
    for (const entry of found.items) {
      const row = entry as Record<string, unknown>;
      documents.set(String(row.id), documentInfoOf(row, useAsTitle));
    }
  }
  const singular = collection.labels?.singular ?? slug;
  return {
    names: { singular, plural: collection.labels?.plural ?? singular },
    documents,
  };
}

/** A Single, named by its label: it is one document, and its label names it. */
async function readSingleDocument(
  slug: string,
  entryIds: readonly string[]
): Promise<ScopeDocuments> {
  const single = await singleApi.getSchema(slug);
  const label = single.label || slug;
  const documents = new Map<string, ReleaseDocumentInfo>();
  for (const id of entryIds) {
    documents.set(id, {
      title: label,
      status: null,
      everPublished: null,
      updatedAt: null,
    });
  }
  return { names: { singular: label, plural: label }, documents };
}

/** What the release page knows of its documents' names. */
export interface ReleaseDocumentNames {
  /** A document's title and state, or `undefined` while unknown or unread. */
  documentOf: (
    member: Pick<ReleaseMember, "scopeKind" | "scopeSlug" | "entryId">
  ) => ReleaseDocumentInfo | undefined;
  /** A collection's or Single's names, once read. */
  scopeNamesOf: (scopeSlug: string) => ReleaseScopeNames | undefined;
  /** Whether a scope's read has not answered yet. */
  isPending: (scopeSlug: string) => boolean;
  /** Whether a scope's read failed. */
  isError: (scopeSlug: string) => boolean;
}

/**
 * The titles of a release's documents, one read per collection or Single.
 *
 * The members list names a document by its collection and id; its page names
 * it by title. One read per collection, for every member in it at once, keeps
 * a release of two hundred documents to a handful of requests. Keyed under the
 * `releases` root, so a release write refreshes the titles with the rest, and
 * by the ids asked for, so a document added is read with its collection.
 */
export function useReleaseDocumentNames(
  releaseId: string | undefined,
  members: readonly ReleaseMember[]
): ReleaseDocumentNames {
  const scopes = new Map<
    string,
    { scopeKind: ReleaseMember["scopeKind"]; scopeSlug: string; ids: string[] }
  >();
  for (const member of members) {
    const key = `${member.scopeKind}:${member.scopeSlug}`;
    const held = scopes.get(key) ?? {
      scopeKind: member.scopeKind,
      scopeSlug: member.scopeSlug,
      ids: [],
    };
    if (!held.ids.includes(member.entryId)) held.ids.push(member.entryId);
    scopes.set(key, held);
  }
  const list = [...scopes.values()];
  const results = useQueries({
    queries: list.map(scope => {
      const ids = [...scope.ids].sort();
      return {
        queryKey: releaseKeys.documents(
          releaseId ?? "",
          scope.scopeKind,
          scope.scopeSlug,
          ids.join(",")
        ),
        queryFn: () =>
          scope.scopeKind === "single"
            ? readSingleDocument(scope.scopeSlug, ids)
            : readCollectionDocuments(scope.scopeSlug, ids),
        enabled: Boolean(releaseId),
        placeholderData: keepPreviousData,
      };
    }),
  });
  const bySlug = new Map<string, (typeof results)[number]>();
  list.forEach((scope, index) => {
    const result = results[index];
    if (result) bySlug.set(scope.scopeSlug, result);
  });
  return {
    documentOf: member =>
      bySlug.get(member.scopeSlug)?.data?.documents.get(member.entryId),
    scopeNamesOf: slug => bySlug.get(slug)?.data?.names,
    isPending: slug => bySlug.get(slug)?.isPending ?? false,
    isError: slug => bySlug.get(slug)?.isError ?? false,
  };
}

/**
 * Other releases a page names, such as one that also holds a document, read
 * for their titles. Shares the detail read's cache, so a release already read
 * is not read again.
 */
export function useReleaseTitles(ids: readonly string[]) {
  const results = useQueries({
    queries: ids.map(id => ({
      queryKey: releaseKeys.detail(id),
      queryFn: () => fetchRelease(id),
    })),
  });
  const titles = new Map<string, string>();
  ids.forEach((id, index) => {
    const title = results[index]?.data?.title;
    if (title) titles.set(id, title);
  });
  return (id: string) => titles.get(id);
}

export function useUpdateRelease(id: string) {
  const refresh = useRefreshRelease();
  return useMutation({
    ...NO_RETRY,
    mutationFn: (payload: UpdateReleasePayload) => updateRelease(id, payload),
    onSuccess: () => {
      refresh(id);
      toast.success("Release updated.");
    },
  });
}

export function useChangeReleaseMemberAction(releaseId: string) {
  const refresh = useRefreshRelease();
  return useMutation({
    ...NO_RETRY,
    mutationFn: ({
      memberId,
      action,
    }: {
      memberId: string;
      action: ReleaseMemberAction;
    }) => changeReleaseMemberAction(releaseId, memberId, action),
    onSuccess: (_result, { action }) => {
      refresh(releaseId);
      toast.success(
        action === "publish" ? "It now goes live." : "It now comes down."
      );
    },
  });
}
