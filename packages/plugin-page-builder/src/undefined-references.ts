/**
 * Which ids a write brings that the site does not define, told apart from the
 * ones the stored value already held.
 *
 * The one comparison every reference the site keeps by id to something it
 * defines is judged by: a page's to a shared style, a breakpoint or a
 * variable (`fields/added-undefined-ids`, which reads the stored page), and
 * a shared style's to a variable (the site-style Single's guard). A value
 * already holding an id the site has since dropped must stay savable, so only
 * an id the write ADDS is refused. Kept apart from the page's stored read so
 * the Single, which the admin's bundle reaches, can use it without that read.
 *
 * @module undefined-references
 */

/**
 * The ids in `used` the site does not define and the stored value does not
 * already hold, in the order `used` names them.
 */
export function newUndefinedIds(
  used: Iterable<string>,
  defined: ReadonlySet<string>,
  held: ReadonlySet<string>
): string[] {
  return [...used].filter(id => !defined.has(id) && !held.has(id));
}
