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

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

/**
 * Returns the nextlyMeta Drizzle table for the requested dialect.
 */
export function nextlyMetaTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return { nextlyMeta: pg.nextlyMeta };
    case "mysql":
      return { nextlyMeta: my.nextlyMeta };
    case "sqlite":
      return { nextlyMeta: sl.nextlyMeta };
    default: {
      // Exhaustiveness check — TypeScript flags any missing dialect at compile time.
      const _exhaustive: never = dialect;
      throw new Error(`Unsupported dialect: ${String(_exhaustive)}`);
    }
  }
}
