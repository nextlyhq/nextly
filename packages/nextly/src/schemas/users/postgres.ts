/**
 * User identity tables — PostgreSQL.
 *
 * Tables: users.
 * Moved verbatim from packages/nextly/src/database/schema/postgres.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Cross-table `relations()` blocks live in `../_dialect-bundles/postgres.relations.ts` (split
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
    // Set when an admin creates the account with a password they chose: the
    // person must replace it on first sign-in (ASVS 6.4.1). Nullable so the
    // column can be added to an existing table without a data-losing default;
    // null and false both mean "no forced change".
    mustChangePassword: boolean("must_change_password"),
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
