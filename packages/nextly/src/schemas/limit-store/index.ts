/**
 * `nextly_limit_store` — dialect-aware barrel.
 *
 * @module schemas/limit-store
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

// Re-exported from the leaf that declares them, so this barrel stays one of
// the readers rather than becoming a second author. See `./table-name`.
export { LIMIT_STORE_TABLE, LIMIT_STORE_COUNTER_PREFIX } from "./table-name";

/** The limit store's table for the requested dialect, as a schema fragment. */
export function limitStoreTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyLimitStore } = loadedDialect(dialect).tables;
  return { nextlyLimitStore };
}
