/**
 * usePublishAllLocales — publish every language of an entry at once (i18n M7, spec §10).
 *
 * Calls `POST /entries/{id}/publish-all`, which applies every language's pending change and moves
 * every language's status in one write, and invalidates the entry's detail + the collection list so
 * the pills, badges, and status reflect the new state.
 *
 * @module hooks/queries/usePublishAllLocales
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import { entryApi, entryKeys } from "@admin/services/entryApi";

export interface UsePublishAllLocalesOptions {
  collectionSlug: string;
  /** Suppress the success/error toast (default: false). */
  silent?: boolean;
}

export function usePublishAllLocales({
  collectionSlug,
  silent = false,
}: UsePublishAllLocalesOptions) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entryId: string) =>
      entryApi.publishAllLocales(collectionSlug, entryId),
    onSuccess: (result, entryId) => {
      // Refresh the entry detail (all locale-keyed variants) and the collection list.
      void queryClient.invalidateQueries({
        queryKey: entryKeys.detail(collectionSlug, entryId),
      });
      void queryClient.invalidateQueries({
        queryKey: entryKeys.lists(),
      });
      // The server's message, which names the direction the write took: a hook
      // can keep a requested publish as a draft.
      if (!silent) toast.success(result.message);
    },
    onError: (error: unknown) => {
      // The server's own message, which is the only thing that says WHY. This
      // call can refuse for reasons an editor can act on, and a fixed string
      // turns every one of them into the same unexplained failure.
      if (!silent) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : "Couldn't publish all languages."
        );
      }
    },
  });
}
