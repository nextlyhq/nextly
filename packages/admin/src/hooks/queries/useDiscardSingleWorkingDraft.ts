"use client";

/**
 * useDiscardSingleWorkingDraft — throw away a Single's pending change for one
 * language and reset the editor to the live published document.
 *
 * The collection equivalent is `useDiscardWorkingDraft`. They stay separate for
 * the reason `usePublishAllSingleLocales` records: the two are addressed
 * differently — an entry by collection slug and id, a Single by its slug alone —
 * and each owns its own query keys. What they share is the server behaviour,
 * which lives in one place already.
 *
 * @see services/versionApi.ts - discardWorkingDraft fetcher
 * @see hooks/queries/useDiscardWorkingDraft.ts - the collection equivalent
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import {
  versionApi,
  type DiscardWorkingDraftResponse,
} from "@admin/services/versionApi";

import { singleDocumentKeys } from "./useSingles";

export interface UseDiscardSingleWorkingDraftOptions {
  /** The Single's slug. */
  slug: string;
  /**
   * The live document's id. Not sent — the server resolves it from the live row
   * rather than trusting the client — but required by the scope so a cache can
   * tell one incarnation of a Single from a recreated one.
   */
  documentId: string;
  /**
   * Which language's pending change to discard. A localized Single holds one per
   * language, so discarding without naming one would throw away a language the
   * author never opened. Absent for an unlocalized Single, and for the default
   * language, which the editor addresses without naming it.
   */
  locale?: string | null;
  /** Fired on success with the live published document. */
  onSuccess?: (data: DiscardWorkingDraftResponse) => void;
  onError?: (error: Error) => void;
  /** Whether to show toast notifications (default: true). */
  showToast?: boolean;
}

export function useDiscardSingleWorkingDraft({
  slug,
  documentId,
  locale,
  onSuccess,
  onError,
  showToast = true,
}: UseDiscardSingleWorkingDraftOptions) {
  const queryClient = useQueryClient();

  return useMutation<DiscardWorkingDraftResponse, Error, void>({
    mutationFn: () =>
      versionApi.discardWorkingDraft(
        { kind: "single", slug, documentId },
        locale
      ),

    onSuccess: data => {
      // Seed the live document the discard returned before invalidating, so a
      // slow or failed refetch cannot leave the editor showing Changed against
      // values that no longer exist.
      //
      // Only the variants reading the SAME language. The response is one
      // language's document and `detail(slug)` is a prefix of every locale-keyed
      // variant, so seeding across all of them would write this language's
      // values into another language's cache entry.
      queryClient.setQueriesData<Record<string, unknown>>(
        {
          queryKey: singleDocumentKeys.detail(slug),
          predicate: query => {
            const scope = query.queryKey[query.queryKey.length - 1];
            // An entry cached under the bare detail key carries no read
            // dimensions to disagree with, so it is still seeded.
            if (typeof scope !== "object" || scope === null) return true;
            // The read key normalises an absent locale to null, and so does this
            // hook, so the default language compares equal on both sides.
            return (
              (scope as { locale?: string | null }).locale === (locale ?? null)
            );
          },
        },
        old => (old ? { ...old, ...data.item, _isWorkingDraft: false } : old)
      );

      // The editor reads with the draft overlay; with the sidecar gone the
      // server has no draft to apply, so a refetch reconciles with the live row.
      void queryClient.invalidateQueries({
        queryKey: singleDocumentKeys.detail(slug),
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
