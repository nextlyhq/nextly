/**
 * Wrapper around the `pluralize` npm package so call sites can swap it
 * for a different library (or our own) later without churn.
 *
 * @module lib/builder/pluralize-helper
 */
import pluralize from "pluralize";

/**
 * Pluralize a singular noun. Handles regular forms, -y/-ies, -s/-x/-ch/-sh,
 * irregular plurals (person -> people), and uncountables (information).
 * Returns empty string for empty/whitespace input.
 */
export function pluralizeName(singular: string): string {
  const trimmed = singular.trim();
  if (trimmed === "") return "";
  return pluralize(trimmed);
}
