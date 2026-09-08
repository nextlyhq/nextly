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
