/**
 * Schema-events table — dialect-aware barrel.
 *
 * Re-exports the per-dialect `nextly_schema_events` Drizzle table under a
 * canonical name. The runtime dialect determines which table a caller sees.
 *
 * @module schemas/schema-events
 * @since v0.0.3-alpha (Plan B)
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

/**
 * Returns the Drizzle table object for the schema-events feature group, for
 * the requested dialect.
 */
export function schemaEventsTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlySchemaEvents } = loadedDialect(dialect).tables;
  return { nextlySchemaEvents };
}
