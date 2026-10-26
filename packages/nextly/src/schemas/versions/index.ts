/**
 * Versions table - dialect-aware barrel.
 *
 * Re-exports the per-dialect `nextly_versions` Drizzle table under a canonical
 * name; the runtime dialect selects which table a caller sees.
 *
 * @module schemas/versions
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

/** Returns the Drizzle table object for the versions feature group. */
export function versionsTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyVersions } = loadedDialect(dialect).tables;
  return { nextlyVersions };
}
