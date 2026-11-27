/**
 * What changed in a translated field's source since its translation was made,
 * and keeping that translation as it is.
 *
 * @module services/sourceReviewApi
 * @experimental
 */

import { protectedApi } from "@admin/lib/api/protectedApi";
import type { TranslatedDocument } from "@admin/lib/navigation/translation-address";

/** Why what a translation was made from can't be shown. */
export type SourceUnavailable =
  | "unknown-origin"
  | "source-moved"
  | "original"
  | "source-language-removed"
  | "not-kept";

/** What a "Keep current" is sent back with; absent where there is none to name. */
interface ReviewFingerprints {
  valueFingerprint?: string;
  sourceFingerprint?: string;
}

/** The source as the translation was made, and as it is now, as stored. */
export type SourceChange = ReviewFingerprints &
  (
    | {
        available: true;
        sourceLocale: string;
        before: unknown;
        after: unknown;
      }
    | {
        available: false;
        reason: SourceUnavailable;
        /** Absent for a value written originally in its own language. */
        sourceLocale?: string;
        after?: unknown;
      }
  );

/** One translated field of a document. */
export interface TranslatedFieldRef {
  document: TranslatedDocument;
  /** The translation's language. */
  locale: string;
  field: string;
}

function documentPath(document: TranslatedDocument): string {
  const slug = encodeURIComponent(document.slug);
  return document.kind === "single"
    ? `/singles/${slug}`
    : `/collections/${slug}/entries/${encodeURIComponent(document.id)}`;
}

/** What changed in the field's source since its translation was made. */
export function fetchSourceChange({
  document,
  locale,
  field,
}: TranslatedFieldRef): Promise<SourceChange> {
  const named = new URLSearchParams({ locale, field });
  return protectedApi.get<SourceChange>(
    `${documentPath(document)}/source-change?${named.toString()}`
  );
}

/**
 * Marks the translation as right against the source as it is now. The
 * fingerprints are the read's own, so what was shown is what is kept: the
 * server refuses where either has changed since.
 */
export function keepTranslation(
  { document, locale, field }: TranslatedFieldRef,
  shown: { valueFingerprint: string; sourceFingerprint: string }
): Promise<unknown> {
  return protectedApi.post(`${documentPath(document)}/keep-current`, {
    locale,
    field,
    ...shown,
  });
}
