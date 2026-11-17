"use client";

/**
 * Version History Query Hooks
 *
 * Query Keys:
 * - `["versions"]` — base key for invalidation
 * - `["versions", "list", kind, slug, entryId]` — one document's history
 * - `["versions", "detail", kind, slug, entryId, versionNo]` — one version
 *
 * @see https://tanstack.com/query/v5/docs/react/reference/useInfiniteQuery
 */

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useState } from "react";

import {
  versionApi,
  type DocumentEventListResponse,
  type SetVersionLabelResponse,
  type VersionDetail,
  type VersionDiff,
  type VersionListResponse,
  type VersionScope,
} from "@admin/services/versionApi";

import { refreshRemovedFromCodeSchema } from "./removed-from-code-refusal";

/** Page size for the history list. */
const PAGE_SIZE = 25;

/**
 * Page size for a document's events. A version usually brings one or two
 * events with it, so a page of them reaches back about as far as a page of
 * versions does.
 */
const EVENTS_PAGE_SIZE = 50;

/**
 * Stable cache identity for a scope, so two documents never share a page.
 *
 * A Single's URL carries no entry id, but its cache key does: the server
 * refuses to serve a recreated Single its predecessor's snapshots, and keying
 * only on the slug would let a client that fetched before the recreation
 * re-render those cached pages without asking again.
 */
export function scopeKey(scope: VersionScope): readonly string[] {
  return scope.kind === "single"
    ? ["single", scope.slug, scope.documentId]
    : ["collection", scope.slug, scope.entryId];
}

/**
 * Whether the scope names a document at all. A collection entry that has never
 * been saved has no id, and interpolating an empty one builds a URL that
 * addresses the collection rather than an entry.
 */
function isAddressable(scope: VersionScope): boolean {
  if (!scope.slug) return false;
  return scope.kind === "single"
    ? Boolean(scope.documentId)
    : Boolean(scope.entryId);
}

// ============================================================
// Query Key Factory
// ============================================================

export const versionKeys = {
  all: () => ["versions"] as const,
  lists: (): readonly ["versions", "list"] =>
    [...versionKeys.all(), "list"] as const,
  // The optional locale is appended, so a locale-filtered list is its own cache
  // entry while `list(scope)` (no locale) stays the prefix every mutation
  // invalidates — that prefix match still clears every locale variant.
  list: (
    scope: VersionScope,
    locale?: string
  ): readonly ["versions", "list", ...string[]] =>
    [
      ...versionKeys.lists(),
      ...scopeKey(scope),
      ...(locale !== undefined ? [locale] : []),
    ] as const,
  // Under `all()`, so every mutation that clears history clears the events
  // beside it too: a restore or a rename writes an event as well as a version.
  events: (scope: VersionScope): readonly ["versions", "events", ...string[]] =>
    [...versionKeys.all(), "events", ...scopeKey(scope)] as const,
  details: (): readonly ["versions", "detail"] =>
    [...versionKeys.all(), "detail"] as const,
  detail: (
    scope: VersionScope,
    versionNo: number
  ): readonly ["versions", "detail", ...string[], number] =>
    [...versionKeys.details(), ...scopeKey(scope), versionNo] as const,
  diffs: (): readonly ["versions", "diff"] =>
    [...versionKeys.all(), "diff"] as const,
  // What every comparison of one document starts with, so a cached
  // answer can be told to belong to that document by its key alone.
  documentDiffs: (scope: VersionScope): readonly string[] =>
    [...versionKeys.diffs(), ...scopeKey(scope)] as const,
  // A comparison with a baseline the server resolves: named by the baseline,
  // the version compared (or none, for the server's own choice), and the
  // language the server pairs in when no version is named. A baseline resolved
  // once per visit also carries that visit, so the next visit asks again.
  // No language is `null` in the key, not a word: a language code is whatever
  // the app configures, so any word could also be a code, and that language
  // would be answered with the default part's comparison.
  baselineDiff: (
    scope: VersionScope,
    baseline: string,
    to: number | undefined,
    locale: string | undefined,
    visit: number | undefined
  ): readonly unknown[] =>
    [
      ...versionKeys.documentDiffs(scope),
      baseline,
      to ?? "auto",
      locale ?? null,
      ...(visit !== undefined ? [`visit-${visit}`] : []),
    ] as const,
  // A diff is identified by the document (scope), the ordered version pair
  // (from, to), and whether unchanged fields are filtered out (modifiedOnly).
  // The result also depends on the live schema, which the query treats as
  // always stale rather than fold into the key (see useVersionDiff).
  diff: (
    scope: VersionScope,
    from: number,
    to: number,
    modifiedOnly: boolean
  ): readonly ["versions", "diff", ...string[], number, number, boolean] =>
    [
      ...versionKeys.diffs(),
      ...scopeKey(scope),
      from,
      to,
      modifiedOnly,
    ] as const,
};

// ============================================================
// Query Hooks
// ============================================================

export interface UseVersionsOptions {
  scope: VersionScope;
  enabled?: boolean;
  /** Scope the listing to one locale's versions. Absent lists every locale. */
  locale?: string;
}

/**
 * One document's history, newest first, paged by keyset.
 *
 * The response carries no cursor of its own, so the next one is the oldest
 * `versionNo` on the page just received.
 *
 * Focus refetch is enabled explicitly (the provider turns it off app-wide, so
 * `staleTime: 0` alone would not revalidate on focus): a save in another tab
 * adds a version, and "Compare with current" reads the newest row from this
 * list, so returning to the panel must revalidate the head or it would label a
 * stale version as current.
 */
export function useVersions({
  scope,
  enabled = true,
  locale,
}: UseVersionsOptions): UseInfiniteQueryResult<
  InfiniteData<VersionListResponse, unknown>,
  Error
> {
  return useInfiniteQuery<VersionListResponse, Error>({
    queryKey: versionKeys.list(scope, locale),
    queryFn: ({ pageParam }) =>
      versionApi.list(scope, {
        limit: PAGE_SIZE,
        ...(typeof pageParam === "number" ? { cursor: pageParam } : {}),
        ...(locale !== undefined ? { locale } : {}),
      }),
    initialPageParam: undefined,
    getNextPageParam: lastPage => {
      // `hasNext` comes from the server's probe row and is the only reliable
      // signal: `total` describes the returned window, not the history.
      if (!lastPage.meta?.hasNext) return undefined;

      // Autosave rows carry a null `versionNo` and cannot anchor a keyset walk,
      // so a page ending in one stops paging rather than querying `< null`.
      const last = lastPage.items.at(-1);
      return typeof last?.versionNo === "number" ? last.versionNo : undefined;
    },
    enabled: enabled && isAddressable(scope),
    // Saving the document adds a version, and the panel is opened on demand, so
    // each open re-reads rather than serving a list captured before the save.
    staleTime: 0,
    // The provider disables focus refetch app-wide; re-enable it here so a save
    // made in another tab is reflected when this panel regains focus (see above).
    refetchOnWindowFocus: true,
  });
}

export interface UseDocumentEventsOptions {
  scope: VersionScope;
  enabled?: boolean;
}

/**
 * One document's events, newest first, paged by the last event's id.
 *
 * Fresh on every open and on focus, as the version list is: a save or a
 * publish in another tab adds an event the history must show beside its
 * version.
 *
 * @experimental
 */
export function useDocumentEvents({
  scope,
  enabled = true,
}: UseDocumentEventsOptions): UseInfiniteQueryResult<
  InfiniteData<DocumentEventListResponse, unknown>,
  Error
> {
  return useInfiniteQuery<DocumentEventListResponse, Error>({
    queryKey: versionKeys.events(scope),
    queryFn: ({ pageParam }) =>
      versionApi.events(scope, {
        limit: EVENTS_PAGE_SIZE,
        ...(typeof pageParam === "string" ? { before: pageParam } : {}),
      }),
    initialPageParam: undefined,
    getNextPageParam: lastPage =>
      lastPage.meta?.hasNext ? lastPage.items.at(-1)?.id : undefined,
    enabled: enabled && isAddressable(scope),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

export interface UseVersionOptions {
  scope: VersionScope;
  versionNo: number | null;
  enabled?: boolean;
}

/**
 * One stored version, including its snapshot.
 *
 * A version's CONTENT never changes — history is append-only — so this stays
 * fresh longer than the list, which grows as the document is edited. Its label
 * can change, and a rename invalidates this key rather than waiting the window
 * out.
 */
export function useVersion({
  scope,
  versionNo,
  enabled = true,
}: UseVersionOptions): UseQueryResult<VersionDetail, Error> {
  return useQuery<VersionDetail, Error>({
    // A disabled placeholder must not occupy the parent key, which a broad
    // `invalidateQueries({ queryKey: versionKeys.details() })` would match.
    queryKey:
      versionNo === null
        ? ([...versionKeys.details(), "none"] as const)
        : versionKeys.detail(scope, versionNo),
    queryFn: () => {
      // Guarded by `enabled`; this is defence against a direct queryFn call.
      if (versionNo === null) throw new Error("A version number is required");
      return versionApi.get(scope, versionNo);
    },
    enabled: enabled && versionNo !== null && isAddressable(scope),
    staleTime: 60_000,
  });
}

export interface UseVersionDiffOptions {
  scope: VersionScope;
  /** Older version number; null disables the query. */
  from: number | null;
  /** Newer version number; null disables the query. */
  to: number | null;
  /** Return only changed fields. */
  modifiedOnly?: boolean;
  enabled?: boolean;
  /**
   * The baseline whose answer fills this pair's comparison
   * (`useBaselineDiff`), when one does. That answer is the whole comparison,
   * so the pair is not asked for again when it mounts, nor on a return while
   * the baseline itself is asked again then.
   */
  seededBy?: string;
}

/**
 * A diff of two versions. The snapshots are immutable, but the server classifies
 * and renders them against the live schema, so the result is not immutable
 * across schema edits. Rather than fingerprint every schema attribute that feeds
 * the diff, the query is treated as always stale: each time the compare view
 * mounts it revalidates, so an edited schema yields a fresh diff. Focus refetch
 * is enabled explicitly for the same reason: a schema edited in another tab is
 * picked up on returning here rather than showing an obsolete classification.
 * The provider disables focus refetch app-wide, so `staleTime: 0` alone would
 * not revalidate on focus; opting back in has to be explicit.
 */
export function useVersionDiff({
  scope,
  from,
  to,
  modifiedOnly = false,
  enabled = true,
  seededBy,
}: UseVersionDiffOptions): UseQueryResult<VersionDiff, Error> {
  // A pair a baseline's answer fills is revalidated on a return only when that
  // baseline is not: one resolved once per visit leaves the live schema's
  // reclassification to the pair, and any other is asked again on a return,
  // and its answer fills the pair once more.
  const revalidatesOnReturn =
    seededBy === undefined || resolvedOncePerVisit(seededBy);
  return useQuery<VersionDiff, Error>({
    queryKey:
      from === null || to === null
        ? ([...versionKeys.diffs(), "none"] as const)
        : versionKeys.diff(scope, from, to, modifiedOnly),
    queryFn: () => {
      // Guarded by `enabled`; this is defence against a direct queryFn call.
      if (from === null || to === null) {
        throw new Error("Two version numbers are required");
      }
      return versionApi.diff(scope, from, to, { modifiedOnly });
    },
    enabled: enabled && from !== null && to !== null && isAddressable(scope),
    staleTime: 0,
    // Filled by the baseline's answer just before it mounts, so not asked
    // again then (see `seededBy`).
    refetchOnMount: seededBy === undefined,
    // The provider disables focus refetch app-wide; re-enable it here so a
    // schema edited in another tab reclassifies the diff on return (see above).
    refetchOnWindowFocus: revalidatesOnReturn,
    refetchOnReconnect: revalidatesOnReturn,
    // Toggling "Changed only" switches to a different cache entry; keep the
    // prior diff on screen while the new one loads rather than flashing a
    // skeleton over a comparison the user is already reading.
    placeholderData: keepPreviousData,
  });
}

/**
 * Whether a baseline is resolved once per visit rather than again on every
 * return: "the version you last looked at", which its own showing moves (see
 * `useBaselineDiff`).
 */
function resolvedOncePerVisit(baseline: string): boolean {
  return baseline === "last-viewed";
}

/** Numbers each visit to a baseline comparison; see `useBaselineDiff`. */
let visitCount = 0;
function nextVisit(): number {
  visitCount += 1;
  return visitCount;
}

/**
 * A baseline's answer as the comparison of the pair it resolved: the same
 * fields, without the note about the baseline, which an explicit pair's own
 * answer never carries.
 */
function pairComparisonOf(answer: VersionDiff): VersionDiff {
  const pair = { ...answer };
  delete pair.baseline;
  return pair;
}

/**
 * A version compared with a baseline the server resolves (see
 * `versionApi.diffFromBaseline`). Null asks for nothing.
 *
 * The answer is the whole comparison of the pair it resolved, so it also
 * fills that pair's own comparison (`useVersionDiff`, with `seededBy`), which
 * then draws it without asking the server to compute it a second time.
 *
 * What is published and the current draft are resolved again whenever the
 * reader returns, the network does, or the comparison mounts: a publish or a
 * draft saved in another tab changes what they name, and the comparison and
 * the restore it offers should follow.
 *
 * "The version you last looked at" is the exception, resolved once per visit
 * and never refetched by focus or reconnection within it. Showing the
 * comparison marks its newer version seen, which moves that baseline onto the
 * version itself: asked again, the server would answer that there is nothing
 * to compare, replacing the comparison the reader is looking at. Freezing it
 * costs no freshness the reader can see, because the pair's own comparison
 * (`useVersionDiff`) still revalidates its fields against the live schema.
 * Marking a version seen invalidates nothing, so it cannot refetch this
 * either.
 *
 * A visit is one mount of the hook, which the comparison page holds for as
 * long as it is open, across changes of address. Its key carries the visit,
 * so a reader who leaves and comes back is answered afresh: the version seen
 * on the last visit is the baseline of this one, and an answer cached from
 * then would compare the previous visit's pair instead.
 *
 * `locale` is the language the server pairs in when `to` is absent, and is
 * part of the key, so one language's answer never stands for another's.
 */
export function useBaselineDiff({
  scope,
  baseline,
  to,
  locale,
  enabled = true,
}: {
  scope: VersionScope;
  baseline: string | null;
  to?: number;
  locale?: string;
  enabled?: boolean;
}): UseQueryResult<VersionDiff, Error> {
  const queryClient = useQueryClient();
  // Taken once, as the visit begins (see above).
  const [visit] = useState(nextVisit);
  // The start every baseline key of this document shares, so a previous
  // answer can be told apart from another document's.
  const documentKey = versionKeys.documentDiffs(scope);
  // The one baseline its own showing moves (see above).
  const resolvedOnce = baseline !== null && resolvedOncePerVisit(baseline);
  return useQuery<VersionDiff, Error>({
    queryKey:
      baseline === null
        ? ([...versionKeys.diffs(), "none"] as const)
        : versionKeys.baselineDiff(
            scope,
            baseline,
            to,
            locale,
            resolvedOnce ? visit : undefined
          ),
    queryFn: async () => {
      // Guarded by `enabled`; this is defence against a direct queryFn call.
      if (baseline === null) throw new Error("A baseline is required");
      const answer = await versionApi.diffFromBaseline(scope, baseline, {
        ...(to !== undefined ? { to } : {}),
        ...(locale !== undefined ? { locale } : {}),
      });
      // Every field is in the answer, as in the pair's own comparison of
      // every field (see above).
      queryClient.setQueryData(
        versionKeys.diff(scope, answer.from, answer.to, false),
        pairComparisonOf(answer)
      );
      return answer;
    },
    enabled: enabled && baseline !== null && isAddressable(scope),
    // Frozen for the visit, or re-resolved on every return (see above). Focus
    // refetch is opted into explicitly: the provider turns it off app-wide.
    staleTime: resolvedOnce ? Infinity : 0,
    refetchOnWindowFocus: !resolvedOnce,
    refetchOnReconnect: !resolvedOnce,
    // The previous comparison stays on screen while another baseline of the
    // SAME document loads. Never another document's: the router can move from
    // one document's comparison to another's without unmounting, and that
    // pair, drawn under the new document's heading, would also be marked
    // seen on the new document, moving its "last looked at" to a version
    // never shown.
    placeholderData: (previous, previousQuery) =>
      previousQuery !== undefined &&
      documentKey.every((part, i) => previousQuery.queryKey[i] === part)
        ? previous
        : undefined,
  });
}

// ============================================================
// Mutation Hooks
// ============================================================

/** Options for renaming a version. */
export interface UseSetVersionLabelOptions {
  scope: VersionScope;
  onSuccess?: (result: SetVersionLabelResponse) => void;
  onError?: (error: Error) => void;
}

/** What a rename is asked to do: `null` clears the name. */
export interface SetVersionLabelInput {
  versionNo: number;
  label: string | null;
}

/**
 * Name a version, or clear its name.
 *
 * Only the version caches are invalidated: a label is metadata about history
 * and touches no document content, so the entry and single-document caches a
 * restore has to clear are left alone. The detail key is included because a
 * renamed version is stale there too, despite its snapshot being unchanged.
 *
 * Unlike a restore this is idempotent — the same name applied twice leaves the
 * same state — so the default retry behaviour is correct and is left in place.
 */
export function useSetVersionLabel({
  scope,
  onSuccess,
  onError,
}: UseSetVersionLabelOptions): UseMutationResult<
  SetVersionLabelResponse,
  Error,
  SetVersionLabelInput,
  unknown
> {
  const queryClient = useQueryClient();

  return useMutation<SetVersionLabelResponse, Error, SetVersionLabelInput>({
    mutationFn: ({ versionNo, label }) =>
      versionApi.setLabel(scope, versionNo, label),
    onError: error => {
      // A refusal because the entity was removed from code reads its schema
      // again, so a screen opened before the removal turns read-only.
      refreshRemovedFromCodeSchema(queryClient, error);
      onError?.(error);
    },
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: versionKeys.all() });
      onSuccess?.(result);
    },
  });
}
