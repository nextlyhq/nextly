/**
 * `nextly_schema_owners` — dialect-aware barrel.
 *
 * @module schemas/schema-owners
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

// Re-exported from the leaf that declares it, so this barrel stays one of the
// readers rather than becoming a second author.
export { SCHEMA_OWNERS_TABLE } from "./table-name";

/** The owners table for the requested dialect, as a schema fragment. */
export function schemaOwnersTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlySchemaOwners } = loadedDialect(dialect).tables;
  return { nextlySchemaOwners };
}
