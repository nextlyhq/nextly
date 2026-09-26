/**
 * User identity tables — SQLite.
 *
 * Tables: users.
 * Moved verbatim from packages/nextly/src/database/schema/sqlite.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Cross-table relations live in `../_dialect-bundles/sqlite.relations.ts` and are re-exported
 * at the bottom of this file. See `./postgres.ts` for the rationale.
 *
 * @module schemas/users/sqlite
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { BuildColumns } from "drizzle-orm";
import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

import { USERS_INDEXES, sqliteIndexes } from "../_internal/core-indexes";
import { sqliteTimestamp } from "../_internal/sqlite-timestamp";

/** `users` columns, a fresh builder record per call (see `core-table-contributions`). */
export function usersColumns() {
  return {
    id: text("id").primaryKey(),
    name: text("name"),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "timestamp" }),
    passwordUpdatedAt: integer("password_updated_at", { mode: "timestamp" }),
    image: text("image"),
    passwordHash: text("password_hash"),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(false),
    // Set when an admin creates the account with a password they chose: the
    // person must replace it on first sign-in (ASVS 6.4.1). Nullable so the
    // column can be added to an existing table without a data-losing default;
    // null and false both mean "no forced change".
    mustChangePassword: integer("must_change_password", { mode: "boolean" }),
    // Brute-force protection: tracks failed login attempts and account lockout
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: integer("locked_until", { mode: "timestamp" }),
    createdAt: sqliteTimestamp("created_at"),
    updatedAt: sqliteTimestamp("updated_at"),
  };
}

/** `users` indexes, from `USERS_INDEXES`. */
export function usersExtraConfig(
  t: BuildColumns<"users", ReturnType<typeof usersColumns>, "sqlite">
) {
  return sqliteIndexes(USERS_INDEXES, t);
}

export const users = sqliteTable("users", usersColumns(), usersExtraConfig);
