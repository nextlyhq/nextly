/**
 * The reserved keys a filter may carry only at its TOP level, each a condition
 * on another table rather than a field: the language filter and the two
 * workflow keys.
 *
 * Its own module, importing nothing, because two very different readers need
 * the one list. The server's shape check refuses any of them nested inside
 * `and`/`or`, and the admin's entry list, which adds its own status and date
 * filters beside a linked one, must keep exactly these at the top level or the
 * server refuses the link. A copy in the admin agrees only on the day it is
 * written: a key added here and not there is wrapped in an `and` the moment a
 * status filter is set, and the list answers with an error.
 *
 * Exported as `nextly/reserved-filter-keys` so a browser bundle reaches the
 * list without the SQL the server builds from it.
 *
 * @module domains/collections/query/reserved-filter-keys
 * @experimental The workflow keys may change until the dashboard's Needs
 *   attention card is complete.
 */

/** The reserved key carrying the language filter. */
export const TRANSLATED_KEY = "_translated";

/** The reserved key keeping entries with unpublished changes. @experimental */
export const PENDING_CHANGE_KEY = "_pendingChange";

/** The reserved key keeping entries a scheduled release will publish. @experimental */
export const IN_RELEASE_KEY = "_inRelease";

/**
 * Every key a filter may carry only at its top level.
 *
 * @experimental
 */
export const RESERVED_TOP_LEVEL_KEYS = [
  TRANSLATED_KEY,
  PENDING_CHANGE_KEY,
  IN_RELEASE_KEY,
] as const;

/** @experimental */
export type ReservedTopLevelKey = (typeof RESERVED_TOP_LEVEL_KEYS)[number];

/**
 * Whether a filter key is one a filter may carry only at its top level.
 *
 * @experimental
 */
export function isReservedTopLevelKey(key: string): key is ReservedTopLevelKey {
  return (RESERVED_TOP_LEVEL_KEYS as readonly string[]).includes(key);
}
