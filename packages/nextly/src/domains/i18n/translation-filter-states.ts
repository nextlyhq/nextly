/**
 * Every translation state a filter may name, and the source its type is built
 * from.
 *
 * A tuple rather than a union so there is something to READ at runtime. The
 * query service and the worklist endpoint both have to decide whether an
 * incoming string is a state, and while the union existed they each declared
 * their own list of the same words — so adding or renaming one could make the
 * endpoint accept a value the query layer silently drops, or refuse one it
 * supports.
 *
 * Its own module, importing nothing, because the admin puts these values on the
 * wire and offers a tab for each. The file that uses them on the server builds
 * SQL, and a browser bundle reaching it would reach the ORM, so the list lives
 * where a client can import it without that graph. A copy written in the admin
 * instead is a second list that agrees only on the day it is written: a state
 * the server stops accepting stays on offer, and the author sees an empty
 * worklist rather than an error.
 *
 * @module domains/i18n/translation-filter-states
 */

export const TRANSLATION_FILTER_STATES = [
  "missing",
  "translated",
  "draft",
  "published",
  "stale",
] as const;

export type TranslationFilterState = (typeof TRANSLATION_FILTER_STATES)[number];
