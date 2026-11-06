/**
 * nextly_meta runtime metadata table — dialect-aware barrel.
 *
 * Re-exports the per-dialect nextlyMeta Drizzle table. The runtime dialect
 * determines which table object a caller sees.
 *
 * @module schemas/nextly-meta
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

/**
 * Returns the nextlyMeta Drizzle table for the requested dialect.
 */
export function nextlyMetaTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyMeta } = loadedDialect(dialect).tables;
  return { nextlyMeta };
}
