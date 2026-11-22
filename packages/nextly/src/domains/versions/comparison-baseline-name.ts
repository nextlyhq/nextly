/**
 * The grammar of a comparison baseline's name: kebab-case, starting with a
 * letter ("previous", "since-approved").
 *
 * The one copy. The registry refuses to register a name that does not match,
 * and the admin reads a name from a comparison's address by it, so a name the
 * registry could hold always reaches the server and one it never could is not
 * sent. WHICH names exist stays the registry's to say.
 *
 * Imports nothing, so a browser bundle reaches it without the registry behind
 * it, which reads the database; its own entry, `nextly/comparison-baseline-name`.
 *
 * @module domains/versions/comparison-baseline-name
 * @experimental
 */

const BASELINE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Whether `name` is spelled as a comparison baseline's name may be.
 *
 * @experimental
 */
export function isComparisonBaselineName(name: string): boolean {
  return BASELINE_NAME.test(name);
}
