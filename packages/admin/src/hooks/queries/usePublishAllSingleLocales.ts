/**
 * usePublishAllSingleLocales — publish every language of a Single at once.
 *
 * Calls `POST /singles/{slug}/publish-all` (atomic server-side: the main status
 * and every companion `_status` move in one transaction) and invalidates the
 * document so the language dots, badges and status reflect the new state.
 *
 * The entry equivalent is `usePublishAllLocales`. They stay separate rather
 * than sharing one hook because the two are addressed differently — an entry by
 * collection slug and id, a Single by its slug alone — and each owns its own
 * query keys. What they DO share is the availability rule, which lives in
 * `usePublishAllLanguages` and is the only part that could drift.
 *
 * @module hooks/queries/usePublishAllSingleLocales
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import { singleApi } from "@admin/services/singleApi";

import { singleDocumentKeys } from "./useSingles";

export interface UsePublishAllSingleLocalesOptions {
  slug: string;
  /** Suppress the success/error toast (default: false). */
  silent?: boolean;
}

export function usePublishAllSingleLocales({
  slug,
  silent = false,
}: UsePublishAllSingleLocalesOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => singleApi.publishAllLocales(slug),
    onSuccess: () => {
      // Every locale-keyed variant of this document changed status, so the
      // whole detail key goes rather than one language's entry.
      void queryClient.invalidateQueries({
        queryKey: singleDocumentKeys.detail(slug),
      });
      if (!silent) toast.success("All languages published.");
    },
    onError: () => {
      if (!silent) toast.error("Couldn't publish all languages.");
    },
  });
}
