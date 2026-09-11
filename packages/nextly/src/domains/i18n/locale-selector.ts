/**
 * Which languages an operation reaches.
 *
 * A lifecycle transition — publish, withdraw, and whatever a later version adds
 * — applies either to ONE translation or to every translation of a document.
 * Expressing that as a selector rather than as a second method is what stops the
 * question being answered once per verb: `publishAllLocales` stated it for
 * publishing, and an `unpublishAllLocales` beside it would have stated the same
 * thing again, for the same table, in the same shape.
 *
 * The wildcard is spelled `"*"` deliberately. It is the spelling Strapi's
 * document service settled on for exactly this parameter, so anybody arriving
 * from that ecosystem guesses right; and it cannot collide with a real locale,
 * because a locale code is validated against a pattern that admits only letters,
 * digits and separators.
 *
 * A READ has a selector of its own, {@link EVERY_TRANSLATION}, and that one is
 * made of letters — so it CAN collide with a code, and the same validation
 * reserves it instead. Both live here so the question "is this a selector or a
 * language" has one answer, {@link isLocaleSelector}, for the configuration
 * that reserves the spellings, the boundary that refuses them, and any caller
 * that has to tell a visitor's language from a wildcard it forwarded.
 *
 * @module domains/i18n/locale-selector
 */

/**
 * Every language of the document.
 *
 * Compare against this rather than writing `"*"` at a call site: a bare literal
 * is indistinguishable from a locale code to a reader, and to a grep.
 */
export const EVERY_LOCALE = "*";

/** Whether a selector names every language rather than one of them. */
export function isEveryLocale(selector: string): boolean {
  return selector === EVERY_LOCALE;
}

/**
 * Every translation of the document, in one answer.
 *
 * The READ selector: a read naming it is answered with a value per language
 * for each localized field, rather than with one language resolved through
 * the fallback chain. Not a language a visitor can be in, and not a locale a
 * write can store into.
 */
export const EVERY_TRANSLATION = "all";

/**
 * Whether a `locale` value is one of the selectors rather than a language code.
 *
 * The one place that knows both spellings. A boundary refusing them and a
 * route normalising them away must agree on what "them" is, and two lists
 * agree only until one gains an entry.
 */
export function isLocaleSelector(locale: string): boolean {
  return isEveryLocale(locale) || locale === EVERY_TRANSLATION;
}

/**
 * No fallback at all, spelled for the wire.
 *
 * A read may ask for exactly the requested language and nothing standing in
 * for it — `fallbackLocale: false` in code, and this string on a query
 * string, which cannot carry a boolean. Not a locale, and so not a language a
 * site may configure: a configured `none` could never be chosen as a fallback,
 * since naming it disables fallback instead.
 */
export const NO_FALLBACK = "none";

/**
 * Whether a string can be configured as a locale code at all.
 *
 * Every spelling the core reads as an instruction rather than a language: the
 * two selectors and the fallback sentinel. A code that is one of these would be
 * accepted by the code pattern — they are letters — and then be unreachable as
 * a language, so configuration refuses them by this one list.
 */
export function isReservedLocaleCode(code: string): boolean {
  return isLocaleSelector(code) || code === NO_FALLBACK;
}
