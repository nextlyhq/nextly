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
  return freeDuplicateName(source, name => taken.has(name));
}

/**
 * The first of `source`, then `source` with the next numeric suffix, that
 * `isTaken` says is free: what a copy is named when "taken" means more than
 * an exact match, such as a sibling's name in other letter case.
 */
export function freeDuplicateName(
  source: string,
  isTaken: (name: string) => boolean
): string {
  if (!isTaken(source)) return source;

  const match = source.match(SUFFIX_PATTERN);
  const base = match ? match[1] : source;
  let n = match ? Number(match[2]) + 1 : 2;

  while (isTaken(`${base}_${n}`)) {
    n += 1;
  }
  return `${base}_${n}`;
}
