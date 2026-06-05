/**
 * API Keys table — dialect-aware barrel.
 *
 * Re-exports the per-dialect apiKeys Drizzle table. The runtime dialect
 * determines which table object a caller sees.
 *
 * Distinct from `schemas/_zod/api-keys.ts`, which holds the Zod validators
 * (CreateApiKeySchema, UpdateApiKeySchema, etc.) for the same domain.
 *
 * @module schemas/api-keys
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

/**
 * Returns the apiKeys Drizzle table for the requested dialect.
 */
export function apiKeyTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return { apiKeys: pg.apiKeys };
    case "mysql":
      return { apiKeys: my.apiKeys };
    case "sqlite":
      return { apiKeys: sl.apiKeys };
    default: {
      // Exhaustiveness check — TypeScript flags any missing dialect at compile time.
      const _exhaustive: never = dialect;
      throw new Error(`Unsupported dialect: ${String(_exhaustive)}`);
    }
  }
}
