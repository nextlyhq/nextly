"use client";

/**
 * usePublishAllLanguages — gating and action for "publish every language",
 * shared by every surface that offers it.
 *
 * The action renders in the document rail and in the header's Languages menu;
 * the availability rule (localized draft collection, saved entry, several
 * languages, publish permission) must be one implementation or the two
 * surfaces drift into disagreeing about who may publish.
 *
 * @module components/features/entries/usePublishAllLanguages
 */

import { usePublishAllLocales } from "@admin/hooks/queries/usePublishAllLocales";
import { useCan } from "@admin/hooks/useCan";
import { useLocalization } from "@admin/hooks/useLocalization";

import { useEntryLocale } from "./EntryLocaleContext";

export interface PublishAllLanguages {
  /** Whether the action applies here at all; surfaces render nothing when false. */
  available: boolean;
  /** True while the publish is in flight. */
  pending: boolean;
  /** Publish every language of the current entry. */
  publishAll: () => void;
}

export function usePublishAllLanguages({
  hasStatus,
}: {
  /** Whether the collection has the Draft/Published lifecycle. */
  hasStatus?: boolean;
}): PublishAllLanguages {
  const { enabled, locales } = useLocalization();
  const { collectionLocalized, collectionSlug, entryId } = useEntryLocale();
  const mutation = usePublishAllLocales({
    collectionSlug: collectionSlug ?? "",
  });
  // Publishing every language is a publish, so it owes the same permission the
  // header Publish button does. Empty slug matches no permission, keeping the
  // hook unconditional.
  const canPublish = useCan(`publish-${collectionSlug ?? ""}`);

  const available =
    enabled &&
    !!hasStatus &&
    collectionLocalized &&
    !!collectionSlug &&
    !!entryId &&
    locales.length >= 2 &&
    canPublish;

  return {
    available,
    pending: mutation.isPending,
    publishAll: () => {
      if (entryId) mutation.mutate(entryId);
    },
  };
}
