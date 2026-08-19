"use client";

/**
 * What the Single editor reads: the document it edits, and the source document
 * it shows while translating.
 *
 * Extracted from the page because the two reads are one concern with several
 * interlocking rules — which language, whether to fall back, whether to ask for
 * the pending change — and each rule is a place where getting it wrong shows the
 * author another language's text as their own.
 *
 * @module hooks/queries/useSingleEditorDocument
 */

import type { SingleDocument } from "@admin/services/singleApi";

import { useSingleDocument } from "./useSingles";

export interface UseSingleEditorDocumentArgs {
  slug?: string;
  /** The active content language. `undefined` = the app default. */
  locale?: string;
  /** The app's default locale, for deciding whether a source read is needed. */
  defaultLocale?: string;
  /** Whether content localization is configured at all. */
  localizationEnabled: boolean;
  /**
   * Whether a status-less save on this Single is HELD as a pending change.
   * When it is, the editor asks to see that pending change rather than the
   * published document — otherwise an author's own held edit is invisible to
   * them, and the save that stored it reported success.
   */
  draftsEnabled: boolean;
  /** The language translation mode is translating FROM, if it named one. */
  translateFrom?: string;
}

export interface UseSingleEditorDocumentResult {
  document: SingleDocument | undefined;
  isLoading: boolean;
  error: Error | null;
  /** The source-language document, while translating. */
  sourceDoc: SingleDocument | undefined;
  /** Whether the active language differs from the app default. */
  isNonDefaultLocale: boolean;
}

export function useSingleEditorDocument({
  slug,
  locale,
  defaultLocale,
  localizationEnabled,
  draftsEnabled,
  translateFrom,
}: UseSingleEditorDocumentArgs): UseSingleEditorDocumentResult {
  const {
    data: document,
    isLoading,
    error,
  } = useSingleDocument(slug, {
    locale,
    // Edit the ACTUAL per-locale values — no fallback, so an untranslated field
    // shows empty rather than the default language's text, which would bleed the
    // source into the field and risk saving it as this language's translation.
    fallbackLocale: localizationEnabled ? "none" : undefined,
    translationStatus: localizationEnabled,
    draft: draftsEnabled,
  });

  const isNonDefaultLocale =
    !!locale && !!defaultLocale && locale !== defaultLocale;

  // The language the source is read AT. Translation mode names it explicitly;
  // otherwise the inline hint's source has always been the app default.
  const sourceLocale = translateFrom ?? defaultLocale;
  const { data: sourceDoc } = useSingleDocument(slug, {
    locale: sourceLocale,
    // No fallback, matching `entry-locale-source.ts`'s SOURCE_READ. With
    // fallback on, an untranslated SOURCE field resolves to yet another
    // language's text — presented as this language's source and copied into the
    // target as if it were a translation.
    fallbackLocale: "none",
    queryOptions: {
      enabled: (isNonDefaultLocale || !!translateFrom) && !!slug,
    },
  });

  return { document, isLoading, error, sourceDoc, isNonDefaultLocale };
}
