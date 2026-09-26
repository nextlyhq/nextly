/**
 * User identity tables — MySQL.
 *
 * Tables: users.
 * Moved verbatim from packages/nextly/src/database/schema/mysql.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Cross-table relations live in `../_dialect-bundles/mysql.relations.ts` and are re-exported
 * at the bottom of this file. See `./postgres.ts` for the rationale.
 *
 * @module schemas/users/mysql
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { BuildColumns } from "drizzle-orm";
import {
  mysqlTable,
  int,
  varchar,
  datetime,
  boolean,
  timestamp,
} from "drizzle-orm/mysql-core";

import { USERS_INDEXES, mysqlIndexes } from "../_internal/core-indexes";

/** `users` columns, a fresh builder record per call (see `core-table-contributions`). */
export function usersColumns() {
  return {
    // Auth.js adapters expect string ids; use varchar to ensure compatibility
    id: varchar("id", { length: 191 }).primaryKey(),
    name: varchar("name", { length: 255 }),
    email: varchar("email", { length: 255 }).notNull(),
    emailVerified: datetime("email_verified"),
    passwordUpdatedAt: datetime("password_updated_at"),
    image: varchar("image", { length: 255 }),
    passwordHash: varchar("password_hash", { length: 255 }),
    isActive: boolean("is_active").notNull().default(false),
    // Set when an admin creates the account with a password they chose: the
    // person must replace it on first sign-in (ASVS 6.4.1). Nullable so the
    // column can be added to an existing table without a data-losing default;
    // null and false both mean "no forced change".
    mustChangePassword: boolean("must_change_password"),
    // Brute-force protection: tracks failed login attempts and account lockout
    failedLoginAttempts: int("failed_login_attempts").notNull().default(0),
    lockedUntil: datetime("locked_until"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  };
}

/** `users` indexes, from `USERS_INDEXES`. */
export function usersExtraConfig(
  t: BuildColumns<"users", ReturnType<typeof usersColumns>, "mysql">
) {
  return mysqlIndexes(USERS_INDEXES, t);
}

export const users = mysqlTable("users", usersColumns(), usersExtraConfig);
