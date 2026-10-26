/**
 * Release tables - dialect-aware barrel.
 *
 * Re-exports the per-dialect release tables under canonical names; the runtime
 * dialect selects which tables a caller sees.
 *
 * @module schemas/releases
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

/** Returns the Drizzle table objects for the releases feature group. */
export function releasesTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyReleaseMembers, nextlyReleases } =
    loadedDialect(dialect).tables;
  return { nextlyReleaseMembers, nextlyReleases };
}
