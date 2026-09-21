/**
 * Declaring database tables from a plugin.
 *
 * Re-exported from core rather than re-declared, for the same reason `db.ts`
 * re-exports the query operators: the DSL's output is compiled by core, and a
 * second copy of the types would describe a shape core does not build.
 *
 * @module schema
 */
export * from "nextly/schema-extension";
