/**
 * What a password sign-in needs from the database, and its limits.
 *
 * One set for every path that signs a session from a password — the auth
 * router's password strategy and the Direct API's `login` — so both count a
 * wrong password, lock after the same number of them, and refuse the same
 * accounts. A second set is how one of them would come to check the password
 * alone and issue a session the other refuses.
 *
 * @module auth/credentials/credential-deps
 * @since 1.0.0
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { getDialectTables } from "../../database/index";
import { serializeOnSqlite } from "../../shared/lib/run-adapter-transaction";
import type { DatabaseAdapter } from "../../shared/types/database-adapter";

import type { CredentialDeps } from "./verify-credentials";

/**
 * The credential dependencies over `adapter`.
 *
 * The adapter is asked for on each call rather than captured, because the
 * auth router's dependencies are built before the database is connected.
 */
export function passwordCredentialDeps(
  adapter: () => DrizzleAdapter
): CredentialDeps {
  // The same typing `BaseService.db` reads the handle with.
  const db = () => adapter().getDrizzle<DatabaseAdapter["db"]>();
  return {
    maxLoginAttempts: 5,
    lockoutDurationSeconds: 15 * 60, // 15 minutes
    requireEmailVerification: true,

    // Errors propagate: a failed lookup answered as `null` reads as an unknown
    // email, so a database outage would be reported to the caller as a wrong
    // password.
    findUserByEmail: async (email: string) => {
      const schema = getDialectTables();
      const { eq } = await import("drizzle-orm");
      const result = await db()
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, email.trim().toLowerCase()))
        .limit(1);
      return result[0] || null;
    },

    // The three writes below go through `serializeOnSqlite`: on SQLite a
    // plain write issued while another request's transaction is open lands
    // inside it, and that rollback would reset the count to zero or lift a
    // lockout, giving a password guesser its attempts back.
    incrementFailedAttempts: async (userId: string) => {
      const schema = getDialectTables();
      const { eq, sql } = await import("drizzle-orm");
      await serializeOnSqlite(adapter(), () =>
        db()
          .update(schema.users)
          .set({
            failedLoginAttempts: sql`${schema.users.failedLoginAttempts} + 1`,
          })
          .where(eq(schema.users.id, userId))
      );
    },

    lockAccount: async (userId: string, lockedUntil: Date) => {
      const schema = getDialectTables();
      const { eq } = await import("drizzle-orm");
      await serializeOnSqlite(adapter(), () =>
        db()
          .update(schema.users)
          .set({ lockedUntil, failedLoginAttempts: 0 })
          .where(eq(schema.users.id, userId))
      );
    },

    resetFailedAttempts: async (userId: string) => {
      const schema = getDialectTables();
      const { eq } = await import("drizzle-orm");
      await serializeOnSqlite(adapter(), () =>
        db()
          .update(schema.users)
          .set({ failedLoginAttempts: 0, lockedUntil: null })
          .where(eq(schema.users.id, userId))
      );
    },
  };
}
