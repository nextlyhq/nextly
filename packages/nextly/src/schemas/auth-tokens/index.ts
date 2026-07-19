/**
 * Auth-token tables — dialect-aware barrel.
 *
 * Re-exports per-dialect Drizzle tables under canonical names. The runtime
 * dialect determines which set of tables a caller sees.
 *
 * Note: each dialect's auth-token Drizzle objects have different runtime
 * identities (different columns, types). Callers either pick a dialect at
 * module-load time (test fixtures, dev-server.ts) or use the
 * `getCoreSchema(dialect)` factory in schemas/index.ts that compiles the
 * appropriate set into a NextlySchemaSnapshot.
 *
 * @module schemas/auth-tokens
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };

/**
 * Returns Drizzle table objects for the auth-token feature group, for the
 * requested dialect.
 */
export function authTokenTables(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return {
        emailVerificationTokens: pg.emailVerificationTokens,
        passwordResetTokens: pg.passwordResetTokens,
        userInviteTokens: pg.userInviteTokens,
        refreshTokens: pg.refreshTokens,
      };
    case "mysql":
      return {
        emailVerificationTokens: my.emailVerificationTokens,
        passwordResetTokens: my.passwordResetTokens,
        userInviteTokens: my.userInviteTokens,
        refreshTokens: my.refreshTokens,
      };
    case "sqlite":
      return {
        emailVerificationTokens: sl.emailVerificationTokens,
        passwordResetTokens: sl.passwordResetTokens,
        userInviteTokens: sl.userInviteTokens,
        refreshTokens: sl.refreshTokens,
      };
    default: {
      // Exhaustiveness check — TypeScript flags any missing dialect at compile time.
      const _exhaustive: never = dialect;
      throw new Error(`Unsupported dialect: ${String(_exhaustive)}`);
    }
  }
}
