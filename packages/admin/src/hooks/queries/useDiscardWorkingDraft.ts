"use client";

/**
 * useDiscardWorkingDraft Hook
 *
 * TanStack Query mutation for discarding a published entry's pending working
 * draft (the draft/published split). It calls the discard endpoint, then
 * invalidates the entry detail so the editor refetches the live published row.
 *
 * The list and count caches are intentionally left alone: discarding never
 * touches the live row, so its representation in those views is unchanged.
 *
 * @see services/versionApi.ts - discardWorkingDraft fetcher
 * @see hooks/queries/useDeleteEntry.ts - reference mutation pattern
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import { entryKeys } from "@admin/services/entryApi";
import {
  versionApi,
  type DiscardWorkingDraftResponse,
} from "@admin/services/versionApi";

export interface UseDiscardWorkingDraftOptions {
  /** The collection slug/name containing the entry. */
  collectionSlug: string;
  /** The entry whose working draft is being discarded. */
  entryId: string;
  /**
   * Which language's pending change to discard. A localized document holds one
   * per language, so discarding without naming one would throw away a language
   * the author never opened. Absent for an unlocalized collection, and for the
   * default language, which the editor addresses without naming it.
   */
  locale?: string | null;
  /** Callback fired on a successful discard, with the live published document. */
  onSuccess?: (data: DiscardWorkingDraftResponse) => void;
  /** Callback fired on error. */
  onError?: (error: Error) => void;
  /** Whether to show toast notifications (default: true). */
  showToast?: boolean;
}

export function useDiscardWorkingDraft({
  collectionSlug,
  entryId,
  locale,
  onSuccess,
  onError,
  showToast = true,
}: UseDiscardWorkingDraftOptions) {
  const queryClient = useQueryClient();

  return useMutation<DiscardWorkingDraftResponse, Error, void>({
    mutationFn: () =>
      versionApi.discardWorkingDraft(
        {
          kind: "collection",
          slug: collectionSlug,
          entryId,
        },
        locale
      ),

    onSuccess: data => {
      // Seed the authoritative live row the discard returned into every scoped
      // variant of this entry's detail cache BEFORE invalidating. Otherwise the
      // cache keeps the now-deleted working draft (and `_isWorkingDraft: true`)
      // until the refetch lands: a slow or failed refetch would leave the editor
      // showing Changed, and a remount could briefly restore the discarded
      // values. `_isWorkingDraft` is cleared explicitly — the live item omits it,
      // so a plain spread would let the stale `true` survive.
      // Only the variants reading the SAME language. The response is one
      // language's live document, and the detail key is a prefix of every scoped
      // variant, so seeding it across all of them writes this language's values
      // into another language's cache entry — which the editor would then show
      // on switching, as that language's content.
      queryClient.setQueriesData<Record<string, unknown>>(
        {
          queryKey: entryKeys.detail(collectionSlug, entryId),
          predicate: query => {
            const scope = query.queryKey[query.queryKey.length - 1];
            // An entry cached under the bare detail key carries no read
            // dimensions to disagree with, so it is still seeded.
            if (typeof scope !== "object" || scope === null) return true;
            // `detailScoped` normalises an absent locale to null, and so does
            // this hook, so the default language compares equal on both sides.
            return (
              (scope as { locale?: string | null }).locale === (locale ?? null)
            );
          },
        },
        old => (old ? { ...old, ...data.item, _isWorkingDraft: false } : old)
      );

      // The editor reads with `?draft=1`; with the sidecar gone the server has
      // no draft to overlay, so refetching the detail reconciles with the live
      // row. List/count caches are left alone — the live row never changed.
      void queryClient.invalidateQueries({
        queryKey: entryKeys.detail(collectionSlug, entryId),
      });

      if (showToast) {
        toast.success("Working draft discarded");
      }

      onSuccess?.(data);
    },

    onError: (error: Error) => {
      if (showToast) {
        toast.error(`Failed to discard working draft: ${error.message}`);
      }

      onError?.(error);
    },
  });
}
