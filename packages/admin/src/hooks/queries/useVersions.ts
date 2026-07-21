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
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { entryKeys } from "@admin/services/entryApi";
import {
  versionApi,
  type RestoreVersionResponse,
  type SetVersionLabelResponse,
  type VersionDetail,
  type VersionListResponse,
  type VersionScope,
} from "@admin/services/versionApi";

import { singleDocumentKeys, singleKeys } from "./useSingles";

/** Page size for the history list. */
const PAGE_SIZE = 25;

/**
 * Stable cache identity for a scope, so two documents never share a page.
 *
 * A Single's URL carries no entry id, but its cache key does: the server
 * refuses to serve a recreated Single its predecessor's snapshots, and keying
 * only on the slug would let a client that fetched before the recreation
 * re-render those cached pages without asking again.
 */
function scopeKey(scope: VersionScope): readonly string[] {
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
  lists: () => [...versionKeys.all(), "list"] as const,
  list: (scope: VersionScope) =>
    [...versionKeys.lists(), ...scopeKey(scope)] as const,
  details: () => [...versionKeys.all(), "detail"] as const,
  detail: (scope: VersionScope, versionNo: number) =>
    [...versionKeys.details(), ...scopeKey(scope), versionNo] as const,
};

// ============================================================
// Query Hooks
// ============================================================

export interface UseVersionsOptions {
  scope: VersionScope;
  enabled?: boolean;
}

/**
 * One document's history, newest first, paged by keyset.
 *
 * The response carries no cursor of its own, so the next one is the oldest
 * `versionNo` on the page just received.
 */
export function useVersions({ scope, enabled = true }: UseVersionsOptions) {
  return useInfiniteQuery<VersionListResponse, Error>({
    queryKey: versionKeys.list(scope),
    queryFn: ({ pageParam }) =>
      versionApi.list(scope, {
        limit: PAGE_SIZE,
        ...(typeof pageParam === "number" ? { cursor: pageParam } : {}),
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
}: UseVersionOptions) {
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

// ============================================================
// Mutation Hooks
// ============================================================

export interface UseRestoreVersionOptions {
  scope: VersionScope;
  onSuccess?: (result: RestoreVersionResponse) => void;
  onError?: (error: Error) => void;
}

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
}: UseSetVersionLabelOptions) {
  const queryClient = useQueryClient();

  return useMutation<SetVersionLabelResponse, Error, SetVersionLabelInput>({
    mutationFn: ({ versionNo, label }) =>
      versionApi.setLabel(scope, versionNo, label),
    onError: error => {
      onError?.(error);
    },
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: versionKeys.all() });
      onSuccess?.(result);
    },
  });
}

/**
 * Put the document back to an earlier version.
 *
 * Restoring writes the live document and records a new version, so both the
 * document and its history are stale afterwards. The entry caches are
 * invalidated alongside the version caches, or the editor would keep showing
 * the pre-restore content it already had.
 */
export function useRestoreVersion({
  scope,
  onSuccess,
  onError,
}: UseRestoreVersionOptions) {
  const queryClient = useQueryClient();

  return useMutation<RestoreVersionResponse, Error, number>({
    mutationFn: versionNo => versionApi.restore(scope, versionNo),
    // Mutations retry twice by default. A restore is not idempotent — each
    // attempt is a fresh write that records another version and another outbox
    // event — so a dropped response would otherwise multiply into several
    // restores of the same version.
    retry: false,
    onError: error => {
      onError?.(error);
    },
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: versionKeys.all() });
      void queryClient.invalidateQueries({ queryKey: entryKeys.all });
      if (scope.kind === "single") {
        // The editor reads the document through `singleDocumentKeys`, which is
        // a different root from the metadata list — invalidating only the list
        // would leave the form showing pre-restore content.
        void queryClient.invalidateQueries({
          queryKey: singleDocumentKeys.all(),
        });
        void queryClient.invalidateQueries({ queryKey: singleKeys.all() });
      }
      onSuccess?.(result);
    },
  });
}
