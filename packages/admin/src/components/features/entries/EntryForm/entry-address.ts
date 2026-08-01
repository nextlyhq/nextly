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
    // A published main row is itself publicly readable (the public status filter
    // applies to the main table), and a shared, non-localized slug lives there,
    // so it counts as a live address even when reconciliation has left no
    // companion locale published.
    if (entry?.status === "published") return true;
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
 * Addresses observed as public during this browser session, keyed by entry id (and locale for a
 * localized slug). It lives at module scope, not in a component ref, so it survives the editor
 * unmounting: the loading skeleton shown while an uncached locale loads tears down EntryForm, and a
 * per-instance latch would lose the history and let a formerly public slug follow its title again on
 * return. Keys carry the entry id, so one document never inherits another's history.
 */
const sessionPublicAddresses = new Set<string>();

/**
 * Clear the session address latch. For tests, which assert a fresh latch per case; the app never
 * clears it (its lifetime is intentionally the page session).
 */
export function resetPublicAddressLatch(): void {
  sessionPublicAddresses.clear();
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
 * language, or navigating away and back — including through the loading skeleton that unmounts this
 * editor while an uncached locale loads — does not discard what was already observed. A single slot
 * loses the first address the moment a second one is looked at.
 *
 * The set is bounded by the page session (see {@link sessionPublicAddresses}), because nothing
 * durable records that an entry was once published: there is no first-published timestamp on the
 * row. An entry unpublished, reloaded in a fresh session, and then retitled tracks again. Closing
 * that needs a persisted marker in core rather than a session-lived set here.
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

  if (mode !== "edit" || !entry) return false;
  if (!hasStatus) return true;

  const liveNow = slugLocalized
    ? effectiveEntryStatus(entry, locale, defaultLocale) === "published"
    : anyLocalePublished(entry, collectionLocalized);
  // Freeze on the pending state, but only REMEMBER it once the write has settled — the cache may
  // still be holding an optimistic publish that is about to be rolled back.
  if (liveNow && !mutationPending) sessionPublicAddresses.add(addressKey);
  return liveNow || sessionPublicAddresses.has(addressKey);
}
