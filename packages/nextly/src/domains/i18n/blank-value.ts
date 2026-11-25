/**
 * The blank rule of translated values, in a module that imports nothing, so the companion read
 * and the shared-structure assembly (which the read imports) answer it from one place.
 *
 * @module domains/i18n/blank-value
 */

/** Blank = "not translated": null, undefined, or empty string fall back. 0/false are real values. */
export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}
