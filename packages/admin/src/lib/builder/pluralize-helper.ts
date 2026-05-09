/**
 * Wrapper around the `pluralize` npm package so call sites can swap it
 * for a different library (or our own) later without churn.
 *
 * @module lib/builder/pluralize-helper
 */
import pluralize from "pluralize";

// Why: PR G (feedback 2) -- pluralize misfires on 1-2 character stems
// ("J" -> "Js", "Jo" -> "Jos") which looks like a bug to users typing
// "Job". Gate the call until we have at least 3 non-whitespace chars,
// the point at which `pluralize` produces sensible output most of the
// time. The pluralize npm package has no built-in min-length config;
// the gate lives here.
const MIN_LENGTH_FOR_PLURALIZATION = 3;

/**
 * Pluralize a singular noun. Handles regular forms, -y/-ies, -s/-x/-ch/-sh,
 * irregular plurals (person -> people), and uncountables (information).
 *
 * Returns empty string when:
 *   - input is empty / whitespace-only
 *   - trimmed input is shorter than 3 characters (PR G feedback 2)
 */
export function pluralizeName(singular: string): string {
  const trimmed = singular.trim();
  if (trimmed.length < MIN_LENGTH_FOR_PLURALIZATION) return "";
  return pluralize(trimmed);
}
