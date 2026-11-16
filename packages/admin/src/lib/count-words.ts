/**
 * How the admin says how many of something there are: "1 draft", "2 drafts",
 * "0 drafts". One home for it, so no screen counts in a way another does not.
 *
 * @module lib/count-words
 */

/**
 * The word for `count` of a thing, alone: the singular for exactly one, the
 * plural otherwise, zero included. For a count drawn apart from its word.
 */
export function countWord(
  count: number,
  one: string,
  many = `${one}s`
): string {
  return count === 1 ? one : many;
}

/** The count and its word: `1 email`, `20 emails`. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${countWord(count, one, many)}`;
}
