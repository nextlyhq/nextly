/**
 * The one place `nextly_schema_owners` is spelled.
 *
 * Declared apart from the dialect modules so the barrel and each dialect read
 * the name rather than restating it. Three copies of a table name is three
 * chances for one of them to be wrong on one dialect only.
 *
 * @module schemas/schema-owners/table-name
 */
export const SCHEMA_OWNERS_TABLE = "nextly_schema_owners";
