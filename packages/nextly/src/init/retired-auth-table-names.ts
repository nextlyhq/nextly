/**
 * The names of the auth tables this release stops creating.
 *
 * A leaf module on purpose: the schema-extension entry point reads these names
 * to refuse app tables that would collide with them, and that entry is shipped
 * to browsers. Keeping the constant out of `retired-auth-tables`, which pulls
 * in the schema validator and database introspection, keeps those out of it.
 *
 * @module init/retired-auth-table-names
 */

/** The tables this release stops creating. */
export const RETIRED_AUTH_TABLES: readonly string[] = ["accounts", "sessions"];
