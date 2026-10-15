/**
 * What the spent two-factor challenges' table is called.
 *
 * A leaf, importing nothing, so the three dialect declarations, the SQLite
 * bootstrap DDL, the core-table manifest and the code that writes the marks
 * all read the name from here. A name spelled separately in each could be
 * renamed in some and not others, and the marks would then go to a table
 * nothing creates.
 *
 * @module schemas/spent-challenges/table-name
 */

/** The physical table name, spelled once and read everywhere. */
export const SPENT_CHALLENGES_TABLE = "nextly_spent_challenges";
