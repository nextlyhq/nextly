/**
 * User identity tables — dialect-aware barrel.
 *
 * Re-exports per-dialect Drizzle tables under canonical names. The runtime
 * dialect determines which set of tables a caller sees.
 *
 * Note: each dialect's `users`/`accounts`/`sessions` Drizzle objects have
 * different runtime identities (different columns, types). Callers either pick
 * a dialect at module-load time (test fixtures, dev-server.ts) or use the
 * `getCoreSchema(dialect)` factory in schemas/index.ts that compiles the
 * appropriate set into a NextlySchemaSnapshot.
 *
 * @module schemas/users
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

/**
 * Returns Drizzle table objects for the user identity feature group, for the
 * requested dialect.
 */
export function userTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return { users: pg.users, accounts: pg.accounts, sessions: pg.sessions };
    case "mysql":
      return { users: my.users, accounts: my.accounts, sessions: my.sessions };
    case "sqlite":
      return { users: sl.users, accounts: sl.accounts, sessions: sl.sessions };
    default: {
      // Exhaustiveness check — TypeScript flags any missing dialect at compile time.
      const _exhaustive: never = dialect;
      throw new Error(`Unsupported dialect: ${String(_exhaustive)}`);
    }
  }
}
