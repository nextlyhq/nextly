/**
 * Which locale keys a document's working draft.
 *
 * One function owns this because the store, the read overlay, the promote and
 * the discard all have to agree. Asked separately at each of them the answers
 * could drift, and the failure is silent: a draft written under one key and
 * looked for under another is simply never found again, so the author's pending
 * edit disappears with no error anywhere. That is the same failure mode the
 * eligibility question had before it was given one implementation.
 *
 * An unlocalized document keys under `null` regardless of the locale on the
 * request. A localization-configured app can send a locale on a write to a
 * collection that is not localized, and keying by it would strand the draft the
 * moment a later read arrived under a different one.
 *
 * @module domains/versions/working-draft-locale
 */

/** What the caller knows about the document and the request. */
export interface WorkingDraftLocaleInput {
  /** `collection.localized === true`. */
  documentLocalized: boolean;
  /** The locale this request resolved to, if any. */
  requestLocale?: string | null;
  /** The app's default locale, used when the request named none. */
  defaultLocale?: string | null;
}

/**
 * The locale to key this document's working draft under, or `null` for the
 * unlocalized slot.
 *
 * Returns `null` for a localized document whose locale cannot be resolved.
 * Inventing one would store the draft under a key nothing later reads, which
 * loses the edit as surely as not storing it — and does so while reporting
 * success.
 */
export function workingDraftLocale(
  input: WorkingDraftLocaleInput
): string | null {
  if (!input.documentLocalized) return null;
  return input.requestLocale ?? input.defaultLocale ?? null;
}
