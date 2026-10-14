/**
 * What the database limit store's table is called, and how its counter rows
 * are named.
 *
 * A leaf, importing nothing, so the three dialect declarations, the SQLite
 * bootstrap DDL, the core-table manifest and the store itself all read the
 * name from here. A name spelled separately in each could be renamed in some
 * and not others, and the store would then count in a table nothing creates.
 *
 * @module schemas/limit-store/table-name
 */

/** The physical table name, spelled once and read everywhere. */
export const LIMIT_STORE_TABLE = "nextly_limit_store";

/**
 * What every counter row's id starts with. An entry's id is the 64-character
 * hex digest of its key, which never contains `:`, so a counter row can never
 * be mistaken for an entry.
 */
export const LIMIT_STORE_COUNTER_PREFIX = "capacity:";
