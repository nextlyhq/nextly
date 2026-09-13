/**
 * What the RBAC epoch table is called, and which row holds it.
 *
 * A leaf on purpose: it imports nothing, so the three dialect declarations, the
 * SQLite bootstrap DDL, the core-table manifest and the runtime queries can all
 * read the name from here without any of them importing each other.
 *
 * That matters more for this table than for most. The manifest decides which
 * tables reconciliation creates and which ones introspection expects to find,
 * the DDL decides what is actually created, and the runtime queries decide what
 * is read — so a name spelled separately in each can be renamed in some of them
 * and not others, and the result is not an error. It is a second counter: the
 * install creates and reconciles one table while every epoch read and write
 * goes to another, and the two never disagree loudly because nothing compares
 * them. Every cache in the install then answers from a counter nothing bumps.
 *
 * @module schemas/rbac-epoch/table-name
 */

/**
 * The physical table name, spelled once and read everywhere.
 */
export const RBAC_EPOCH_TABLE = "nextly_rbac_epoch";

/**
 * The key of the single row.
 *
 * A constant rather than a parameter: the primary key is what makes a second
 * counter unrepresentable, and a caller free to choose the key could create one
 * whose bumps nothing else reads.
 */
export const RBAC_EPOCH_ROW_ID = "global";
