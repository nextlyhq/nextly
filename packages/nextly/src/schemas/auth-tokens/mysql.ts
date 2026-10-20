/**
 * Auth-token tables — MySQL.
 *
 * Tables: emailVerificationTokens, passwordResetTokens, refreshTokens.
 * Moved verbatim from packages/nextly/src/database/schema/mysql.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Cross-table `relations()` blocks live in `../_dialect-bundles/mysql.relations.ts` and are
 * re-exported at the bottom of this file. See `./postgres.ts` for the
 * rationale.
 *
 * @module schemas/auth-tokens/mysql
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import { sql, type ColumnBuilderBase } from "drizzle-orm";
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

import { accountTokenIndexes } from "./account-token-indexes";

/**
 * The columns a password-reset and an email-verification token share, with a
 * kind's own columns (`extra`) placed before `created_at`. One definition, so
 * the two tables cannot drift apart on what binds a token to its account.
 */
function accountTokenColumns<E extends Record<string, ColumnBuilderBase>>(
  extra: E
) {
  return {
    id: int("id").autoincrement().primaryKey(),
    identifier: varchar("identifier", { length: 255 }).notNull(),
    // The account the token was issued for. A token is redeemed only for this
    // account, and only while it still holds `identifier`; deleting the
    // account deletes the token with it. Null only on a token issued before
    // the column existed, until the upgrade binds or removes it
    // (`domains/auth/services/token-account-binding`).
    userId: varchar("user_id", { length: 191 }).references(() => users.id, {
      onDelete: "cascade",
    }),
    tokenHash: varchar("token_hash", { length: 255 }).notNull(),
    expires: datetime("expires").notNull(),
    ...extra,
    // DDL-side CURRENT_TIMESTAMP (matching postgres's defaultNow()):
    // a JavaScript `new Date()` default bakes one module-load-time literal
    // into the emitted DDL, so every boot saw a different default and v1's
    // differ emitted MODIFY COLUMN churn forever (the pre-v1 MySQL differ
    // returned empty statement lists and masked this).
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  };
}

// Password reset tokens (custom table)
export const passwordResetTokens = mysqlTable(
  "password_reset_tokens",
  accountTokenColumns({ usedAt: datetime("used_at") }),
  t => [
    ...accountTokenIndexes({ index, uniqueIndex }, "prt", t),
    index("prt_used_at_idx").on(t.usedAt),
  ]
);

// User invite tokens — the single-use set-password link an admin hands to a
// new user. Mirrors passwordResetTokens (with a used_at consume marker), but
// keyed on user_id rather than an email identifier: the invite belongs to one
// account, survives an email change, and keeps the address out of the token
// store. Only the SHA-256 hash of the token is kept, never the raw value.
export const userInviteTokens = mysqlTable(
  "user_invite_tokens",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 191 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 255 }).notNull(),
    expires: datetime("expires").notNull(),
    usedAt: datetime("used_at"),
    // Database-side default: `new Date()` would bake one JS timestamp into the
    // schema and reuse it for every insert.
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  t => [
    // One invite row per account, enforced by the database: two concurrent
    // re-invites cannot both leave a live link, and superseding an earlier
    // invite holds without a read-modify-write race.
    uniqueIndex("uit_user_id_unique").on(t.userId),
    index("uit_token_hash_idx").on(t.tokenHash),
    index("uit_expires_idx").on(t.expires),
  ]
);

// Email verification tokens (custom, hashed)
export const emailVerificationTokens = mysqlTable(
  "email_verification_tokens",
  accountTokenColumns({}),
  t => accountTokenIndexes({ index, uniqueIndex }, "evt", t)
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
    createdAt: datetime("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  t => [
    index("refresh_tokens_token_hash_idx").on(t.tokenHash),
    index("refresh_tokens_user_id_idx").on(t.userId),
    index("refresh_tokens_expires_at_idx").on(t.expiresAt),
  ]
);
