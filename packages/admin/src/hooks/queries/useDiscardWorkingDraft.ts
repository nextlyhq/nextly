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
  onSuccess,
  onError,
  showToast = true,
}: UseDiscardWorkingDraftOptions) {
  const queryClient = useQueryClient();

  return useMutation<DiscardWorkingDraftResponse, Error, void>({
    mutationFn: () =>
      versionApi.discardWorkingDraft({
        kind: "collection",
        slug: collectionSlug,
        entryId,
      }),

    onSuccess: data => {
      // The editor reads with `?draft=1`; with the sidecar gone the server has
      // no draft to overlay, so refetching the detail returns the live row.
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
