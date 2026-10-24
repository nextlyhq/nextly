/**
 * The names of the auth tables Nextly no longer creates or uses: the sign-in
 * tables of an earlier authentication model, and the table permission answers
 * were once stored in between requests.
 *
 * A leaf module on purpose: the schema-extension entry point reads these names
 * to refuse app tables that would collide with them, and that entry is shipped
 * to browsers. Keeping the constant out of `retired-auth-tables`, which pulls
 * in the schema validator and database introspection, keeps those out of it.
 *
 * @module init/retired-auth-table-names
 */

/** The tables Nextly no longer creates. */
export const RETIRED_AUTH_TABLES: readonly string[] = [
  "accounts",
  "sessions",
  "user_permission_cache",
];
