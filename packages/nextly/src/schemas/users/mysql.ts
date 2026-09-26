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

import {
  mysqlTable,
  int,
  varchar,
  datetime,
  index,
  uniqueIndex,
  boolean,
  timestamp,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable(
  "users",
  {
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
  },
  t => [
    uniqueIndex("users_email_unique").on(t.email),
    index("users_created_at_idx").on(t.createdAt),
  ]
);
