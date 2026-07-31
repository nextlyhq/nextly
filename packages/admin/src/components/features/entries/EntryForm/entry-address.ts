"use client";

/**
 * Whether an entry currently has a public address, and which status decides that.
 *
 * Two questions the editor keeps asking in different places: the slug auto-generator needs to know
 * whether re-deriving the slug would retire a live URL, and the slug editor needs to know whether
 * to say so. Both are the same question, and answering it twice is how they drift apart.
 *
 * @module components/features/entries/EntryForm/entry-address
 */

import { useRef } from "react";

import type { EntryData } from "./useEntryForm";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The status that governs the language being edited.
 *
 * Publishing is per locale once a collection is localized, so a row carries one lifecycle per
 * language on its companion and the main row's own `status` describes the default language alone.
 * Reading the main row for a translation therefore reports the wrong lifecycle in both directions:
 * a published translation of a draft row looks unpublished, and a draft translation of a published
 * row looks live.
 *
 * The fallback to `entry.status` is deliberately conditioned on the absence of a `_translations`
 * map rather than on the absence of an entry for this locale. A localized entry with no companion
 * row for the active language is not published in that language, and must not inherit the default
 * language's state by falling through.
 */
export function effectiveEntryStatus(
  entry: EntryData | null | undefined,
  locale: string | undefined
): string | undefined {
  const translations = entry?._translations;
  if (locale !== undefined && isRecord(translations)) {
    const forLocale = translations[locale];
    return isRecord(forLocale) && typeof forLocale.status === "string"
      ? forLocale.status
      : undefined;
  }
  return typeof entry?.status === "string" ? entry.status : undefined;
}

export interface PublicAddressArgs {
  /** Create forms have no address yet; only a persisted entry can have one. */
  mode: "create" | "edit";
  /** Whether the collection has the Draft/Published lifecycle enabled. */
  hasStatus: boolean;
  entry: EntryData | null | undefined;
  /** The language being edited, or undefined for the implicit default. */
  locale: string | undefined;
}

/**
 * Whether this entry's slug is already a public address.
 *
 * Three things make it one, and each covers a case the others miss:
 *
 * - **No Draft/Published lifecycle.** A collection without status has no unpublished state: saving
 *   an entry makes it readable. Asking whether such an entry is "published" can only ever answer
 *   no, which would leave every entry in those collections auto-rewriting its live URL.
 * - **Published in the language being edited**, per {@link effectiveEntryStatus}.
 * - **Published at any point while this editor has been open.** Unpublishing returns the row to
 *   draft, but the links, feeds and search results that accumulated while it was live do not go
 *   away, so republishing under a title-derived slug would silently move it. Latched per entry and
 *   locale so opening a different document does not inherit the previous one's history.
 *
 * The latch is bounded by the editing session because nothing durable records that an entry was
 * once published: there is no first-published timestamp on the row. An entry unpublished, reloaded,
 * and then retitled still tracks. Closing that needs a persisted marker in core rather than a
 * longer-lived ref here.
 */
export function useHasPublicAddress({
  mode,
  hasStatus,
  entry,
  locale,
}: PublicAddressArgs): boolean {
  const key = `${entry?.id ?? ""}:${locale ?? ""}`;
  const seen = useRef<{ key: string; published: boolean }>({
    key,
    published: false,
  });
  if (seen.current.key !== key) {
    seen.current = { key, published: false };
  }

  if (mode !== "edit" || !entry) return false;
  if (!hasStatus) return true;

  if (effectiveEntryStatus(entry, locale) === "published") {
    seen.current.published = true;
  }
  return seen.current.published;
}
