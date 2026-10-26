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

import { loadedDialect } from "../../database/dialect-tables";

/**
 * Returns Drizzle table objects for the auth-token feature group, for the
 * requested dialect.
 */
export function authTokenTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const {
    emailVerificationTokens,
    passwordResetTokens,
    refreshTokens,
    userInviteTokens,
  } = loadedDialect(dialect).tables;
  return {
    emailVerificationTokens,
    passwordResetTokens,
    refreshTokens,
    userInviteTokens,
  };
}
