"use client";

/**
 * Release query hooks.
 *
 * ## Query keys
 *
 * - `["releases"]` — every release query, the invalidation root
 * - `["releases", "list", params]` — one window
 * - `["releases", "detail", id]` — one release
 * - `["releases", "members", id]` — its contents
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
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import {
  addReleaseMember,
  cancelRelease,
  createRelease,
  deleteRelease,
  fetchRelease,
  fetchReleaseBlockers,
  fetchReleaseMembers,
  fetchReleaseReadiness,
  fetchReleases,
  publishReleaseNow,
  removeReleaseMember,
  scheduleRelease,
} from "@admin/services/releaseApi";
import {
  RELEASE_LIST_TABS,
  type AddReleaseMemberPayload,
  type CreateReleasePayload,
  type ReleaseDocumentRef,
  type ReleaseKind,
  type ReleaseListParams,
  type ReleaseListTab,
  type ScheduleReleasePayload,
} from "@admin/types/releases";

export const releaseKeys = {
  all: () => ["releases"] as const,
  list: (params: ReleaseListParams) => ["releases", "list", params] as const,
  detail: (id: string) => ["releases", "detail", id] as const,
  members: (id: string) => ["releases", "members", id] as const,
  blockers: (id: string) => ["releases", "blockers", id] as const,
  readiness: (id: string) => ["releases", "readiness", id] as const,
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
 * the next page, tab or search is being fetched it keeps showing the rows it
 * has, so the table and its pager hold still instead of collapsing to a
 * loading row on every page turn. Polled on the same two speeds as the rest of
 * the releases screens, and for the same reason.
 */
export function useReleaseListPage(params: ReleaseListParams) {
  return useQuery({
    queryKey: releaseKeys.list(params),
    queryFn: () => fetchReleases(params),
    placeholderData: keepPreviousData,
    refetchInterval: data =>
      hasPendingRelease(data.state.data)
        ? PENDING_RELEASE_POLL_MS
        : NO_RELEASE_POLL_MS,
    refetchOnWindowFocus: true,
  });
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
  };
}

/**
 * What the checks say about one release's documents now.
 *
 * Kept for half a minute, and not polled: a list holds a page of these, and
 * each one is worked out over every document its release holds. Its own key
 * rather than the blockers', because the schedule dialog's preflight must
 * never be answered from a cache, and this one may be.
 */
export function useReleaseReadiness(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: releaseKeys.readiness(id ?? ""),
    queryFn: () => fetchReleaseReadiness(id as string),
    enabled: enabled && Boolean(id),
    staleTime: 30_000,
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
