/**
 * Version view markers table - dialect-aware barrel.
 *
 * Re-exports the per-dialect table under one canonical name; the runtime
 * dialect selects which table a caller sees.
 *
 * @module schemas/version-views
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

/** The table's name, the same on every dialect. */
export const VERSION_VIEWS_TABLE = "nextly_version_views";

/** Returns the Drizzle table object for version view markers. */
export function versionViewsTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyVersionViews } = loadedDialect(dialect).tables;
  return { nextlyVersionViews };
}
