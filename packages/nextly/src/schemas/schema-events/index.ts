/**
 * Schema-events table — dialect-aware barrel.
 *
 * Re-exports the per-dialect `nextly_schema_events` Drizzle table under a
 * canonical name. The runtime dialect determines which table a caller sees.
 *
 * @module schemas/schema-events
 * @since v0.0.3-alpha (Plan B)
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

/**
 * Returns the Drizzle table object for the schema-events feature group, for
 * the requested dialect.
 */
export function schemaEventsTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return { nextlySchemaEvents: pg.nextlySchemaEventsPg };
    case "mysql":
      return { nextlySchemaEvents: my.nextlySchemaEventsMysql };
    case "sqlite":
      return { nextlySchemaEvents: sl.nextlySchemaEventsSqlite };
    default: {
      // Exhaustiveness check — TypeScript flags any missing dialect at compile time.
      const _exhaustive: never = dialect;
      throw new Error(`Unsupported dialect: ${String(_exhaustive)}`);
    }
  }
}
