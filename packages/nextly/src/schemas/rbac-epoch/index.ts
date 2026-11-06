/**
 * `nextly_rbac_epoch` — dialect-aware barrel.
 *
 * @module schemas/rbac-epoch
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

// Re-exported from the leaf that declares them, so this barrel stays one of the
// readers rather than becoming a second author. See `./table-name`.
export { RBAC_EPOCH_TABLE, RBAC_EPOCH_ROW_ID } from "./table-name";

/** The epoch table for the requested dialect, as a schema fragment. */
export function rbacEpochTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyRbacEpoch } = loadedDialect(dialect).tables;
  return { nextlyRbacEpoch };
}
