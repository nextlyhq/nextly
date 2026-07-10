/**
 * usePublishAllLocales — publish every language of an entry at once (i18n M7, spec §10).
 *
 * Calls `POST /entries/{id}/publish-all` (atomic server-side: main status + every companion
 * `_status` → published) and invalidates the entry's detail + the collection list so the pills,
 * badges, and status reflect the new state.
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
    onSuccess: (_data, entryId) => {
      // Refresh the entry detail (all locale-keyed variants) and the collection list.
      void queryClient.invalidateQueries({
        queryKey: entryKeys.detail(collectionSlug, entryId),
      });
      void queryClient.invalidateQueries({
        queryKey: entryKeys.lists(),
      });
      if (!silent) toast.success("All languages published.");
    },
    onError: () => {
      if (!silent) toast.error("Couldn't publish all languages.");
    },
  });
}
