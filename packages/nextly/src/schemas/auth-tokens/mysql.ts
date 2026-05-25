/**
 * Auth-token tables — MySQL.
 *
 * Tables: verificationTokens, emailVerificationTokens, passwordResetTokens,
 * refreshTokens.
 * Moved verbatim from packages/nextly/src/database/schema/mysql.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Note: cross-table `relations()` blocks (refreshTokensRelations) remain in
 * database/schema/mysql.ts during Plan A — they reference tables that move in
 * later tasks. Relations consolidate in Task 17 once database/schema/ is
 * removed.
 *
 * @module schemas/auth-tokens/mysql
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
} from "drizzle-orm/mysql-core";

import { users } from "../users/mysql";

export const verificationTokens = mysqlTable(
  "verification_tokens",
  {
    identifier: varchar("identifier", { length: 191 }).notNull(),
    token: varchar("token", { length: 191 }).notNull(),
    expires: datetime("expires").notNull(),
  },
  t => [
    uniqueIndex("verification_tokens_identifier_token_pk").on(
      t.identifier,
      t.token
    ),
    index("verification_tokens_token_idx").on(t.token),
  ]
);

// Password reset tokens (custom table)
export const passwordResetTokens = mysqlTable(
  "password_reset_tokens",
  {
    id: int("id").autoincrement().primaryKey(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    tokenHash: varchar("token_hash", { length: 255 }).notNull(),
    expires: datetime("expires").notNull(),
    usedAt: datetime("used_at"),
    createdAt: datetime("created_at").notNull().default(new Date()),
  },
  t => [
    uniqueIndex("prt_identifier_token_hash_unique").on(
      t.identifier,
      t.tokenHash
    ),
    index("prt_expires_idx").on(t.expires),
    index("prt_used_at_idx").on(t.usedAt),
  ]
);

// Email verification tokens (custom, hashed)
export const emailVerificationTokens = mysqlTable(
  "email_verification_tokens",
  {
    id: int("id").autoincrement().primaryKey(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    tokenHash: varchar("token_hash", { length: 255 }).notNull(),
    expires: datetime("expires").notNull(),
    createdAt: datetime("created_at").notNull().default(new Date()),
  },
  t => [
    uniqueIndex("evt_identifier_token_hash_unique").on(
      t.identifier,
      t.tokenHash
    ),
    index("evt_expires_idx").on(t.expires),
  ]
);

// Refresh tokens for custom auth session management
// Stores SHA-256 hashed opaque tokens, enables session revocation and token rotation
export const refreshTokens = mysqlTable(
  "refresh_tokens",
  {
    id: varchar("id", { length: 191 }).primaryKey(),
    userId: varchar("user_id", { length: 191 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SHA-256 hex digest of the opaque refresh token (never store raw tokens)
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    // Request metadata for session listing and security auditing
    userAgent: text("user_agent"),
    ipAddress: varchar("ip_address", { length: 45 }),
    expiresAt: datetime("expires_at").notNull(),
    createdAt: datetime("created_at").notNull().default(new Date()),
  },
  t => [
    index("refresh_tokens_token_hash_idx").on(t.tokenHash),
    index("refresh_tokens_user_id_idx").on(t.userId),
    index("refresh_tokens_expires_at_idx").on(t.expiresAt),
  ]
);
