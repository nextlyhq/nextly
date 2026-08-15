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
 * The editor represents the default language implicitly as `locale === undefined`, so the caller
 * passes `defaultLocale` to resolve it. After a reconcile the default locale's `_status` can land on
 * the companion and diverge from the main row (a published default over a draft-shaped row); reading
 * the row alone would call it a draft and let a title edit move its already-live slug.
 *
 * When the resolved language has no companion row, the fallback differs by which language it is. A
 * non-default language with no companion is simply not published in it, so it reports no status
 * rather than inheriting the default's. The default language's own content lives on the main row, so
 * it falls back to the row status — as does any language when there is no `_translations` map at all
 * (a non-localized entry, or a request that did not ask for the overview).
 */
export function effectiveEntryStatus(
  entry: EntryData | null | undefined,
  locale: string | undefined,
  defaultLocale?: string
): string | undefined {
  const translations = entry?._translations;
  // The editor shows the default language as `locale === undefined`; resolve it so the default
  // locale's own companion `_status` is read rather than the main row's, which can diverge from it.
  const activeLocale = locale ?? defaultLocale;
  if (activeLocale !== undefined && isRecord(translations)) {
    const forLocale = translations[activeLocale];
    if (isRecord(forLocale) && typeof forLocale.status === "string") {
      return forLocale.status;
    }
    // No companion row for this language. A non-default language is not published in it; the
    // default language's content lives on the main row, so let it fall through to the row status.
    if (activeLocale !== defaultLocale) return undefined;
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
  entry: EntryData | null | undefined,
  collectionLocalized: boolean
): boolean {
  const translations = entry?._translations;
  if (isRecord(translations)) {
    return Object.values(translations).some(
      meta => isRecord(meta) && meta.status === "published"
    );
  }
  // A localized entry whose overview was not requested cannot answer this. The row's own status
  // describes the default language alone, so believing it would call an entry unpublished while
  // another language is live and hand its shared slug back to the generator. The map's absence is
  // a property of the CALLER's query, not of the entry, so the safe reading is the conservative
  // one: assume the address may be public. Callers that need the precise answer ask for the
  // overview — but one that forgets loses auto-slug convenience rather than someone's live URL.
  if (collectionLocalized) return true;
  // Not localized: one lifecycle, and it lives on the row.
  return entry?.status === "published";
}

/**
 * Whether the row records that this entry has been public at some point.
 *
 * `firstPublishedAt` is stamped once, on the first transition into published, and never cleared —
 * so unlike `status` it survives an unpublish, and unlike the latch below it survives a reload.
 * It lives on the main row, which makes it an ENTRY-level fact: "public in some language", not
 * "public in this one".
 *
 * The column is nullable and null for every row that predates it, so a missing marker means "not
 * known to have been published" rather than "never published" — which is why it may only ever add
 * to the answer.
 *
 * A response carries the timestamp serialized while a hook-shaped document carries it decoded, so
 * both are accepted, and both are put through the same parse rather than a string being taken on
 * trust for being non-empty. Freezing is permanent for the session, so a value that does not
 * describe a moment in time — an empty string, a malformed one a custom `afterRead` hook
 * substituted, an `Invalid Date` — must not buy it.
 */
export function everPublishedOnRecord(
  entry: EntryData | null | undefined
): boolean {
  const marker = entry?.firstPublishedAt;
  if (typeof marker !== "string" && !(marker instanceof Date)) return false;
  return !Number.isNaN(new Date(marker).getTime());
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
  /** Whether the collection itself is localized, which decides what the ABSENCE of a translation
   *  overview means — unavailable, or genuinely not applicable. See {@link anyLocalePublished}. */
  collectionLocalized: boolean;
  /**
   * The app's configured default language.
   *
   * The editor represents the default language as `undefined` until the switcher is touched, and
   * as its explicit code afterwards. Those are one address, so the latch key normalises through
   * this — otherwise leaving the default language and returning to it looks up a key that was
   * never written, and a formerly public slug quietly unfreezes.
   */
  defaultLocale: string | undefined;
  /**
   * Whether a write for this entry is currently in flight.
   *
   * The update hook writes the pending status into the query cache optimistically and restores the
   * previous entry if the request fails. A latch is monotonic and cannot roll back with it, so
   * latching mid-flight would make a publish that never happened permanent: the draft's slug would
   * stop following its title, and its slug editor would warn about a public URL that does not
   * exist, until the editor is remounted. The pending state is still allowed to FREEZE — it is
   * only recording it forever that has to wait for the server to agree.
   */
  mutationPending: boolean;
}

/**
 * Whether this entry's slug is already a public address.
 *
 * Four things make it one, and each covers a case the others miss:
 *
 * - **No Draft/Published lifecycle.** A collection without status has no unpublished state: saving
 *   an entry makes it readable. Asking whether such an entry is "published" can only ever answer
 *   no, which would leave every entry in those collections auto-rewriting its live URL.
 * - **Published where this slug is served.** For a slug the author localized, that is the language
 *   in view. For the default shared slug it is ANY language, because they all resolve through the
 *   one field.
 * - **Recorded as having been published before.** The row's own `firstPublishedAt` outlives the
 *   session, so an entry unpublished, reloaded and then retitled is still recognised.
 * - **Published at any point while this editor has been open.** Unpublishing returns the row to
 *   draft, but the links, feeds and search results that accumulated while it was live do not go
 *   away, so republishing under a title-derived slug would silently move it.
 *
 * The latch is a set of addresses rather than a single slot, and is never cleared. Keys carry the
 * entry id, so one document cannot inherit another's history; keeping every key means switching
 * language, or navigating away and back, does not discard what was already observed. A single slot
 * loses the first address the moment a second one is looked at.
 *
 * The recorded marker is consulted only for a SHARED slug. It answers "this entry has been public
 * in some language", which is exactly right when one field serves every language's URL and too
 * coarse when it does not: for a slug the author opted into localizing it would freeze a
 * translation whose own address has never been public. Per-language durability would need the
 * marker on the companion rows; until then the opt-in case keeps the session latch it has now.
 *
 * The four terms are combined by OR alone, so each can only ever ADD freezing. That is what makes
 * partial coverage safe in both directions: a row written before the marker existed, or by a write
 * path that does not stamp it yet, falls back to exactly today's behaviour instead of unfreezing a
 * URL that is live.
 */
export function useHasPublicAddress({
  mode,
  hasStatus,
  entry,
  locale,
  slugLocalized,
  collectionLocalized,
  defaultLocale,
  mutationPending,
}: PublicAddressArgs): boolean {
  // A shared slug is one address for every language, so its key must not carry the locale at all.
  // A localized one does, normalised so the default language cannot occupy two keys.
  const addressKey = `${entry?.id ?? ""}${
    slugLocalized ? `:${locale ?? defaultLocale ?? ""}` : ""
  }`;
  const seenRef = useRef<Set<string> | null>(null);
  seenRef.current ??= new Set<string>();

  if (mode !== "edit" || !entry) return false;
  if (!hasStatus) return true;

  const liveNow = slugLocalized
    ? effectiveEntryStatus(entry, locale) === "published"
    : anyLocalePublished(entry, collectionLocalized);
  // An entry-level fact answers for an entry-level address only. See the note above on why a slug
  // the author localized is left to the latch.
  const publishedOnRecord = !slugLocalized && everPublishedOnRecord(entry);
  // Freeze on the pending state, but only REMEMBER it once the write has settled — the cache may
  // still be holding an optimistic publish that is about to be rolled back. The recorded marker
  // needs no such wait: it is a value the server has already committed, so it is latched at once
  // and a later response that omits the key cannot unfreeze the address.
  if (liveNow && !mutationPending) seenRef.current.add(addressKey);
  if (publishedOnRecord) seenRef.current.add(addressKey);
  return liveNow || publishedOnRecord || seenRef.current.has(addressKey);
}

/**
 * The locale a shareable preview link should be scoped to.
 *
 * The editor spells the default language as `locale === undefined`, and the
 * mint route reads a token with no locale claim as authorizing EVERY locale
 * (`previewTokenCovers` returns true whenever the scope names none). Passing
 * the editor's sentinel straight through would therefore turn a link to one
 * language's draft into a grant covering every unpublished translation of the
 * entry, while a link minted from any NON-default language is correctly
 * restricted — the widening applies to exactly the language most links are
 * shared from.
 *
 * So the sentinel is resolved here rather than at the call site: it is one
 * question with one answer, and a second caller deriving it again is how the
 * two drift apart.
 *
 * A non-localized collection is the one case where an unscoped token is right.
 * It has no locale to name, no translations to leak, and scoping the token to
 * an invented locale would refuse a link that should work.
 */
export function previewLinkLocale({
  localized,
  locale,
  defaultLocale,
}: {
  localized: boolean;
  locale: string | undefined;
  defaultLocale: string | undefined;
}): string | undefined {
  if (!localized) return undefined;
  return locale ?? defaultLocale;
}
