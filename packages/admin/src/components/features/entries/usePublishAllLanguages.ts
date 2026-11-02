"use client";

/**
 * usePublishAllLanguages — gating and action for "publish every language",
 * shared by every surface that offers it.
 *
 * The action renders in the document rail and in the header's Languages menu,
 * on entries and on singles alike; the availability rule (localized draft
 * document, several languages, publish permission) must be one implementation
 * or the surfaces drift into disagreeing about who may publish.
 *
 * The MUTATION is not here. An entry and a single are addressed differently and
 * invalidate different query keys, so each form supplies its own through the
 * `publishAllLanguages` seam on `EntryLocaleContext` — mirroring
 * `fetchSourceValues`. Its presence is also what says the surface can publish at
 * all, so a create form (no saved document to publish) supplies nothing and the
 * action correctly does not offer itself.
 *
 * @module components/features/entries/usePublishAllLanguages
 */

import { useCanRequest } from "@admin/hooks/useCanRequest";
import { useLocalization } from "@admin/hooks/useLocalization";

import { useEntryLocale } from "./EntryLocaleContext";

export interface PublishAllLanguages {
  /** Whether the action applies here at all; surfaces render nothing when false. */
  available: boolean;
  /** True while the publish is in flight. */
  pending: boolean;
  /** Publish every language of the current document. */
  publishAll: () => void;
}

export function usePublishAllLanguages({
  hasStatus,
}: {
  /** Whether the document has the Draft/Published lifecycle. */
  hasStatus?: boolean;
}): PublishAllLanguages {
  const { enabled, locales } = useLocalization();
  const { collectionLocalized, publishAllLanguages } = useEntryLocale();
  // Publishing every language is judged as the server judges that request:
  // the update in every language, then the publish check for each, rather
  // than as a publish in the language on screen. An empty slug names no
  // collection, which keeps the hook unconditional when no seam is supplied.
  const canPublish = useCanRequest(
    publishAllLanguages?.slug ?? "",
    "publishEveryLanguage"
  );

  const available =
    enabled &&
    !!hasStatus &&
    collectionLocalized &&
    !!publishAllLanguages &&
    locales.length >= 2 &&
    canPublish;

  return {
    available,
    pending: publishAllLanguages?.pending ?? false,
    publishAll: () => publishAllLanguages?.publish(),
  };
}
