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

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import {
  versionApi,
  type VersionDetail,
  type VersionListResponse,
  type VersionScope,
} from "@admin/services/versionApi";

/** Page size for the history list. */
const PAGE_SIZE = 25;

/** Stable cache identity for a scope, so two documents never share a page. */
function scopeKey(scope: VersionScope): readonly string[] {
  return scope.kind === "single"
    ? ["single", scope.slug]
    : ["collection", scope.slug, scope.entryId];
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
    enabled: enabled && Boolean(scope.slug),
    staleTime: 30_000,
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
 * A stored version never changes, so this stays fresh longer than the list —
 * which does change as the document is edited.
 */
export function useVersion({
  scope,
  versionNo,
  enabled = true,
}: UseVersionOptions) {
  return useQuery<VersionDetail, Error>({
    queryKey:
      versionNo === null
        ? versionKeys.details()
        : versionKeys.detail(scope, versionNo),
    queryFn: () => {
      // Guarded by `enabled`; this is defence against a direct queryFn call.
      if (versionNo === null) throw new Error("A version number is required");
      return versionApi.get(scope, versionNo);
    },
    enabled: enabled && versionNo !== null,
    staleTime: 60_000,
  });
}
