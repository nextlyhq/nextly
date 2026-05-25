/**
 * User identity tables — MySQL.
 *
 * Tables: users, accounts, sessions.
 * Moved verbatim from packages/nextly/src/database/schema/mysql.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Cross-table relations live in `./mysql-relations.ts` and are re-exported
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
  text,
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

export const accounts = mysqlTable(
  "accounts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 191 }).notNull(),
    type: varchar("type", { length: 191 }).notNull(),
    provider: varchar("provider", { length: 191 }).notNull(),
    providerAccountId: varchar("provider_account_id", {
      length: 191,
    }).notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: int("expires_at"),
    token_type: varchar("token_type", { length: 191 }),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: varchar("session_state", { length: 255 }),
  },
  t => [
    uniqueIndex("accounts_provider_providerAccountId_unique").on(
      t.provider,
      t.providerAccountId
    ),
    index("accounts_user_id_idx").on(t.userId),
  ]
);

export const sessions = mysqlTable(
  "sessions",
  {
    sessionToken: varchar("session_token", { length: 255 }).primaryKey(),
    userId: varchar("user_id", { length: 191 }).notNull(),
    expires: datetime("expires").notNull(),
  },
  t => [index("sessions_user_id_idx").on(t.userId)]
);

// ---------------------------------------------------------------------------
// Relations re-export — see `./postgres.ts` for the rationale.
// ---------------------------------------------------------------------------
export {
  usersRelations,
  accountsRelations,
  sessionsRelations,
} from "./mysql-relations";
