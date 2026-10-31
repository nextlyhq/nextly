/**
 * usePublishAllLocales — publish every language of an entry at once (i18n M7, spec §10).
 *
 * Calls `POST /entries/{id}/publish-all` (atomic server-side: main status + every companion
 * `_status` → published) and invalidates the entry's detail + the collection list so the pills,
 * badges, and status reflect the new state.
 *
 * @module hooks/queries/usePublishAllLocales
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import { entryApi, entryKeys } from "@admin/services/entryApi";

import {
  refreshRemovedFromCodeSchema,
  removedFromCodeRefusal,
} from "./removed-from-code-refusal";

export interface UsePublishAllLocalesOptions {
  collectionSlug: string;
  /** Suppress the success/error toast (default: false). */
  silent?: boolean;
}

export function usePublishAllLocales({
  collectionSlug,
  silent = false,
}: UsePublishAllLocalesOptions): UseMutationResult<
  {
    id: string;
    status?: string;
  },
  Error,
  string,
  unknown
> {
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
    onError: error => {
      // A collection removed from code refuses in a sentence that says what to
      // do next, so that is shown in place of the general one.
      refreshRemovedFromCodeSchema(queryClient, error);
      if (!silent) {
        toast.error(
          removedFromCodeRefusal(error) ?? "Couldn't publish all languages."
        );
      }
    },
  });
}
