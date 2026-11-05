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

import {
  languageLabelOf,
  publishedSummary,
} from "@admin/components/features/entries/publishAllOutcomes";
import { toast } from "@admin/components/ui";
import { useLocalization } from "@admin/hooks/useLocalization";
import {
  refusedAsChangedSince,
  EVERY_LANGUAGE,
  PUBLISH_ALL_CHANGED_SINCE,
  versionToPublishEveryLanguage,
  type ShownCopy,
} from "@admin/lib/document-version";
import { entryApi, entryKeys } from "@admin/services/entryApi";
import type { PublishAllLanguageOutcome } from "@admin/services/publishAllPreview";

import {
  refreshRemovedFromCodeSchema,
  removedFromCodeRefusal,
} from "./removed-from-code-refusal";

export interface UsePublishAllLocalesOptions {
  collectionSlug: string;
  /** Suppress the success/error toast (default: false). */
  silent?: boolean;
  /** The editor's copy, where there is one; see `versionToPublishEveryLanguage`. */
  shown?: () => ShownCopy | undefined;
}

export function usePublishAllLocales({
  collectionSlug,
  silent = false,
  shown,
}: UsePublishAllLocalesOptions): UseMutationResult<
  {
    id: string;
    status?: string;
    languages?: PublishAllLanguageOutcome[];
  },
  Error,
  string,
  unknown
> {
  const queryClient = useQueryClient();
  const labelOf = languageLabelOf(useLocalization().locales);

  return useMutation({
    // With the version of every language, from a read of every language just
    // before: the editor reads one, and a publish of every language is judged
    // on all of them.
    mutationFn: async (entryId: string) =>
      entryApi.publishAllLocales(
        collectionSlug,
        entryId,
        await versionToPublishEveryLanguage(
          () =>
            entryApi.findByID(collectionSlug, entryId, {
              locale: EVERY_LANGUAGE,
            }),
          shown?.(),
          copy =>
            entryApi.findByID(collectionSlug, entryId, {
              locale: copy.locale,
              draft: copy.draft,
            })
        )
      ),
    onSuccess: (data, entryId) => {
      // Refresh the entry detail (all locale-keyed variants) and the collection list.
      void queryClient.invalidateQueries({
        queryKey: entryKeys.detail(collectionSlug, entryId),
      });
      void queryClient.invalidateQueries({
        queryKey: entryKeys.lists(),
      });
      // Each language's outcome, as the publish reports it.
      if (!silent) toast.success(publishedSummary(data.languages, labelOf));
    },
    onError: (error, entryId) => {
      // A collection removed from code refuses in a sentence that says what to
      // do next, so that is shown in place of the general one.
      refreshRemovedFromCodeSchema(queryClient, error);
      // Changed since the editor opened it: read again, so the editor shows
      // the version a second publish would make live.
      const changed = refusedAsChangedSince(error);
      if (changed) {
        void queryClient.invalidateQueries({
          queryKey: entryKeys.detail(collectionSlug, entryId),
        });
      }
      if (!silent) {
        toast.error(
          removedFromCodeRefusal(error) ??
            (changed
              ? PUBLISH_ALL_CHANGED_SINCE
              : "Couldn't publish all languages.")
        );
      }
    },
  });
}
