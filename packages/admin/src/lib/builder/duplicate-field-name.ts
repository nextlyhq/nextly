/**
 * Compute the next available numeric-suffix name for a field duplicate.
 * Returns the source name itself if it's not already taken.
 *
 * Examples:
 *   nextDuplicateName("body", ["body"])                     -> "body_2"
 *   nextDuplicateName("body_2", ["body", "body_2"])         -> "body_3"
 *   nextDuplicateName("body", ["body", "body_2", "body_3"]) -> "body_4"
 *   nextDuplicateName("meta_title", ["metaTitle"])         -> "meta_title_2"
 *
 * @module lib/builder/duplicate-field-name
 */

import { siblingNameClash } from "nextly/config";

const SUFFIX_PATTERN = /^(.+)_(\d+)$/;

/**
 * `takenNames` are the sibling names a candidate may not clash with, by the save's own sibling
 * rule: the same name, the same name in other letter case, or a name that becomes the same
 * column. `isTaken`, when given, says a candidate is unavailable for another reason, such as a
 * built-in column's name, so the suffix moves past it too.
 */
export function nextDuplicateName(
  source: string,
  takenNames: readonly string[],
  isTaken: (name: string) => boolean = () => false
): string {
  const unavailable = (name: string) =>
    isTaken(name) || takenNames.some(other => siblingNameClash(name, other));
  if (!unavailable(source)) return source;

  const match = source.match(SUFFIX_PATTERN);
  const base = match ? match[1] : source;
  let n = match ? Number(match[2]) + 1 : 2;

  while (unavailable(`${base}_${n}`)) {
    n += 1;
  }
  return `${base}_${n}`;
}
