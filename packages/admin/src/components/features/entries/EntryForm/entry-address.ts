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

import { isFieldLocalized } from "nextly/config";
import { useRef } from "react";

import type { EntryData } from "./useEntryForm";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringProp(source: object, key: string): string | undefined {
  return key in source &&
    typeof (source as Record<string, unknown>)[key] === "string"
    ? ((source as Record<string, unknown>)[key] as string)
    : undefined;
}

/**
 * Whether the slug field is per-locale rather than shared.
 *
 * `FieldConfig` is a union whose members do not all carry `localized`, so the classifier's minimal
 * shape is rebuilt from whichever properties are actually present. Falling back to `text` matches
 * how the injected slug is declared, and the classifier answers false for any non-localized
 * collection regardless.
 */
export function isSlugPerLocale(
  slugField: object | undefined,
  collectionLocalized: boolean
): boolean {
  if (!slugField) return false;
  const localized =
    "localized" in slugField &&
    typeof (slugField as Record<string, unknown>).localized === "boolean"
      ? ((slugField as Record<string, unknown>).localized as boolean)
      : undefined;
  return isFieldLocalized(
    {
      type: stringProp(slugField, "type") ?? "text",
      name: stringProp(slugField, "name") ?? "slug",
      localized,
    },
    collectionLocalized
  );
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

/**
 * Whether any language of this entry is published.
 *
 * The translation overview reports every configured locale, so this is answerable from the row the
 * editor already has. Without that map — a non-localized collection, or a request that did not ask
 * for it — the row's own status is the only lifecycle there is.
 */
export function anyLocalePublished(
  entry: EntryData | null | undefined
): boolean {
  const translations = entry?._translations;
  if (!isRecord(translations)) {
    return entry?.status === "published";
  }
  return Object.values(translations).some(
    meta => isRecord(meta) && meta.status === "published"
  );
}

export interface PublicAddressArgs {
  /** Create forms have no address yet; only a persisted entry can have one. */
  mode: "create" | "edit";
  /** Whether the collection has the Draft/Published lifecycle enabled. */
  hasStatus: boolean;
  entry: EntryData | null | undefined;
  /** The language being edited, or undefined for the implicit default. */
  locale: string | undefined;
  /**
   * Whether the slug field itself is per-locale.
   *
   * The auto-injected slug is `localized: false`, so by default ONE slug serves every language's
   * URL. Deciding a shared slug's fate from the language in view means editing a draft
   * translation's title rewrites the address the published language is already being served at.
   * A slug the author opted into localizing is genuinely per-language and follows that language.
   */
  slugLocalized: boolean;
}

/**
 * Whether this entry's slug is already a public address.
 *
 * Three things make it one, and each covers a case the others miss:
 *
 * - **No Draft/Published lifecycle.** A collection without status has no unpublished state: saving
 *   an entry makes it readable. Asking whether such an entry is "published" can only ever answer
 *   no, which would leave every entry in those collections auto-rewriting its live URL.
 * - **Published where this slug is served.** For a slug the author localized, that is the language
 *   in view. For the default shared slug it is ANY language, because they all resolve through the
 *   one field.
 * - **Published at any point while this editor has been open.** Unpublishing returns the row to
 *   draft, but the links, feeds and search results that accumulated while it was live do not go
 *   away, so republishing under a title-derived slug would silently move it.
 *
 * The latch is a set of addresses rather than a single slot, and is never cleared. Keys carry the
 * entry id, so one document cannot inherit another's history; keeping every key means switching
 * language, or navigating away and back, does not discard what was already observed. A single slot
 * loses the first address the moment a second one is looked at.
 *
 * The latch is still bounded by the editing session, because nothing durable records that an entry
 * was once published: there is no first-published timestamp on the row. An entry unpublished,
 * reloaded, and then retitled still tracks. Closing that needs a persisted marker in core rather
 * than a longer-lived ref here.
 */
export function useHasPublicAddress({
  mode,
  hasStatus,
  entry,
  locale,
  slugLocalized,
}: PublicAddressArgs): boolean {
  // A shared slug is one address for every language, so its key must not carry the locale.
  const addressKey = `${entry?.id ?? ""}${slugLocalized ? `:${locale ?? ""}` : ""}`;
  const seenRef = useRef<Set<string> | null>(null);
  seenRef.current ??= new Set<string>();

  if (mode !== "edit" || !entry) return false;
  if (!hasStatus) return true;

  const liveNow = slugLocalized
    ? effectiveEntryStatus(entry, locale) === "published"
    : anyLocalePublished(entry);
  if (liveNow) seenRef.current.add(addressKey);
  return seenRef.current.has(addressKey);
}
