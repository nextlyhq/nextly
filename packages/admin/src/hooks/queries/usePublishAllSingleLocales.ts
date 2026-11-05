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
import type { PublishAllLanguageOutcome } from "@admin/services/publishAllPreview";
import { singleApi } from "@admin/services/singleApi";

import {
  refreshRemovedFromCodeSchema,
  removedFromCodeRefusal,
} from "./removed-from-code-refusal";
import { singleDocumentKeys } from "./useSingles";

export interface UsePublishAllSingleLocalesOptions {
  slug: string;
  /** Suppress the success/error toast (default: false). */
  silent?: boolean;
  /** The editor's copy, where there is one; see `versionToPublishEveryLanguage`. */
  shown?: () => ShownCopy | undefined;
}

export function usePublishAllSingleLocales({
  slug,
  silent = false,
  shown,
}: UsePublishAllSingleLocalesOptions): UseMutationResult<
  {
    id: string;
    status?: string;
    languages?: PublishAllLanguageOutcome[];
  },
  Error,
  void,
  unknown
> {
  const queryClient = useQueryClient();
  const labelOf = languageLabelOf(useLocalization().locales);

  return useMutation({
    // With the version of every language, from a read of every language just
    // before: the editor reads one, and a publish of every language is judged
    // on all of them.
    mutationFn: async () =>
      singleApi.publishAllLocales(
        slug,
        await versionToPublishEveryLanguage(
          () => singleApi.getDocument(slug, { locale: EVERY_LANGUAGE }),
          shown?.(),
          copy =>
            singleApi.getDocument(slug, {
              locale: copy.locale,
              draft: copy.draft,
            })
        )
      ),
    onSuccess: data => {
      // Every locale-keyed variant of this document changed status, so the
      // whole detail key goes rather than one language's entry.
      void queryClient.invalidateQueries({
        queryKey: singleDocumentKeys.detail(slug),
      });
      // Each language's outcome, as the publish reports it.
      if (!silent) toast.success(publishedSummary(data.languages, labelOf));
    },
    onError: error => {
      // A Single removed from code refuses in a sentence that says what to do
      // next, so that is shown in place of the general one.
      refreshRemovedFromCodeSchema(queryClient, error);
      // Changed since the editor opened it: read again, so the editor shows
      // the version a second publish would make live.
      const changed = refusedAsChangedSince(error);
      if (changed) {
        void queryClient.invalidateQueries({
          queryKey: singleDocumentKeys.detail(slug),
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
