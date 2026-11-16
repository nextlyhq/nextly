/**
 * Audit tables — dialect-aware barrel.
 *
 * Re-exports per-dialect Drizzle tables (auditLog, activityLog) under canonical
 * names. The runtime dialect determines which set of tables a caller sees.
 *
 * @module schemas/audit
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

/**
 * Returns Drizzle table objects for the audit feature group, for the requested
 * dialect.
 */
export function auditTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { auditLog, activityLog } = loadedDialect(dialect).tables;
  return { auditLog, activityLog };
}
