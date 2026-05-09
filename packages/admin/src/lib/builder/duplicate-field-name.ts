/**
 * Compute the next available numeric-suffix name for a field duplicate.
 * Returns the source name itself if it's not already taken.
 *
 * Examples:
 *   nextDuplicateName("body", ["body"])                     -> "body_2"
 *   nextDuplicateName("body_2", ["body", "body_2"])         -> "body_3"
 *   nextDuplicateName("body", ["body", "body_2", "body_3"]) -> "body_4"
 *
 * @module lib/builder/duplicate-field-name
 */

const SUFFIX_PATTERN = /^(.+)_(\d+)$/;

export function nextDuplicateName(
  source: string,
  takenNames: readonly string[]
): string {
  const taken = new Set(takenNames);
  if (!taken.has(source)) return source;

  const match = source.match(SUFFIX_PATTERN);
  const base = match ? match[1] : source;
  let n = match ? Number(match[2]) + 1 : 2;

  while (taken.has(`${base}_${n}`)) {
    n += 1;
  }
  return `${base}_${n}`;
}
