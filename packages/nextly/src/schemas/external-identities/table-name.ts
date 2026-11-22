/**
 * What the external identities' table is called.
 *
 * A leaf, importing nothing, so the three dialect declarations, the SQLite
 * bootstrap DDL, the core-table manifest and the code that removes a person's
 * identities with their account all read the name from here. A name spelled
 * separately in each could be renamed in some and not others, and the rows
 * would then go to a table nothing creates.
 *
 * @module schemas/external-identities/table-name
 */

/** The physical table name, spelled once and read everywhere. */
export const EXTERNAL_IDENTITIES_TABLE = "nextly_external_identities";
