/**
 * User identity tables — SQLite.
 *
 * Tables: users, accounts, sessions.
 * Moved verbatim from packages/nextly/src/database/schema/sqlite.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Cross-table relations live in `../_dialect-bundles/sqlite.relations.ts` and are re-exported
 * at the bottom of this file. See `./postgres.ts` for the rationale.
 *
 * @module schemas/users/sqlite
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import {
  sqliteTable,
  integer,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
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
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [
    uniqueIndex("users_email_unique").on(t.email),
    index("users_created_at_idx").on(t.createdAt),
  ]
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  t => [
    uniqueIndex("accounts_provider_providerAccountId_unique").on(
      t.provider,
      t.providerAccountId
    ),
    index("accounts_user_id_idx").on(t.userId),
  ]
);

export const sessions = sqliteTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: text("user_id").notNull(),
    expires: integer("expires", { mode: "timestamp" }).notNull(),
  },
  t => [index("sessions_user_id_idx").on(t.userId)]
);
