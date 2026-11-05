/**
 * User identity tables — dialect-aware barrel.
 *
 * Re-exports per-dialect Drizzle tables under canonical names. The runtime
 * dialect determines which set of tables a caller sees.
 *
 * Note: each dialect's `users` Drizzle object has a different runtime identity
 * (different columns, types). Callers either pick
 * a dialect at module-load time (test fixtures, dev-server.ts) or use the
 * `getCoreSchema(dialect)` factory in schemas/index.ts that compiles the
 * appropriate set into a NextlySchemaSnapshot.
 *
 * @module schemas/users
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

/**
 * Returns Drizzle table objects for the user identity feature group, for the
 * requested dialect.
 */
export function userTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { users } = loadedDialect(dialect).tables;
  return { users };
}
