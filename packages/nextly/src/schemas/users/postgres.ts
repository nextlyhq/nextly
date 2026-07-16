/**
 * User identity tables — PostgreSQL.
 *
 * Tables: users, accounts, sessions.
 * Moved verbatim from packages/nextly/src/database/schema/postgres.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Cross-table `relations()` blocks live in `./postgres-relations.ts` (split
 * out in Task 17 to keep table definitions free of sibling-feature imports).
 * Re-exported at the bottom of this file so consumers using
 * `import * as schema from "./postgres"` still see the relations in the
 * same namespace alongside the tables.
 *
 * @module schemas/users/postgres
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    email: text("email").notNull(),
    emailVerified: timestamp("email_verified", { withTimezone: false }),
    passwordUpdatedAt: timestamp("password_updated_at", {
      withTimezone: false,
    }),
    image: text("image"),
    // Nullable, matching SQLite and MySQL. An invited user has no password
    // until they accept and set one, so the account has to exist without a
    // hash. Loosening a NOT NULL constraint is not data-losing, so drizzle-kit
    // applies it cleanly.
    passwordHash: text("password_hash"),
    isActive: boolean("is_active").notNull().default(false),
    // Brute-force protection: tracks failed login attempts and account lockout
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: false }),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    uniqueIndex("users_email_unique").on(t.email),
    index("users_created_at_idx").on(t.createdAt),
  ]
);

export const accounts = pgTable(
  "accounts",
  {
    id: serial("id").primaryKey(),
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
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    uniqueIndex("accounts_provider_providerAccountId_unique").on(
      t.provider,
      t.providerAccountId
    ),
    index("accounts_user_id_idx").on(t.userId),
  ]
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: text("user_id").notNull(),
    expires: timestamp("expires", { withTimezone: false }).notNull(),
  },
  t => [index("sessions_user_id_idx").on(t.userId)]
);
