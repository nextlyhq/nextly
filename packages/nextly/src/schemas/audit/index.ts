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

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

/**
 * Returns Drizzle table objects for the audit feature group, for the requested
 * dialect.
 */
export function auditTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return { auditLog: pg.auditLog, activityLog: pg.activityLog };
    case "mysql":
      return { auditLog: my.auditLog, activityLog: my.activityLog };
    case "sqlite":
      return { auditLog: sl.auditLog, activityLog: sl.activityLog };
    default: {
      // Exhaustiveness check — TypeScript flags any missing dialect at compile time.
      const _exhaustive: never = dialect;
      throw new Error(`Unsupported dialect: ${String(_exhaustive)}`);
    }
  }
}
