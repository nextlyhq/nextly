/**
 * `nextly_cache_tag_expiries` — dialect-aware barrel.
 *
 * @module schemas/cache-tag-expiries
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

// Re-exported from the leaf that declares it, so this barrel stays one of the
// readers rather than becoming a second author. See `./table-name`.
export { CACHE_TAG_EXPIRIES_TABLE } from "./table-name";

/** The cache tag expiry ledger for the requested dialect, as a schema fragment. */
export function cacheTagExpiriesTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyCacheTagExpiries } = loadedDialect(dialect).tables;
  return { nextlyCacheTagExpiries };
}
