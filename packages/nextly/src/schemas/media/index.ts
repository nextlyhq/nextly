/**
 * Media tables — dialect-aware barrel.
 *
 * Re-exports per-dialect Drizzle tables (media, mediaFolders, imageSizes)
 * under canonical names. The runtime dialect determines which set of tables a
 * caller sees.
 *
 * @module schemas/media
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

/**
 * Returns Drizzle table objects for the media feature group, for the
 * requested dialect.
 */
export function mediaTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { media, mediaFolders, imageSizes } = loadedDialect(dialect).tables;
  return { media, mediaFolders, imageSizes };
}
