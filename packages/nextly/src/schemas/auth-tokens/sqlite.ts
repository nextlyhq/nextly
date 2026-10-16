/**
 * Auth-token tables — SQLite.
 *
 * Tables: emailVerificationTokens, passwordResetTokens, refreshTokens.
 * Moved verbatim from packages/nextly/src/database/schema/sqlite.ts as part of
 * Plan A schemas consolidation. No behavior change.
 *
 * Cross-table `relations()` blocks live in `../_dialect-bundles/sqlite.relations.ts` and are
 * re-exported at the bottom of this file. See `./postgres.ts` for the
 * rationale.
 *
 * @module schemas/auth-tokens/sqlite
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { ColumnBuilderBase } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  text,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { users } from "../users/sqlite";

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
    id: integer("id").primaryKey({ autoIncrement: true }),
    identifier: text("identifier").notNull(),
    // The account the token was issued for. A token is redeemed only for this
    // account, and only while it still holds `identifier`; deleting the
    // account deletes the token with it. Null only on a token issued before
    // the column existed, until the upgrade binds or removes it
    // (`domains/auth/services/token-account-binding`).
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    tokenHash: text("token_hash").notNull(),
    expires: integer("expires", { mode: "timestamp" }).notNull(),
    ...extra,
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  };
}

// Password reset tokens (custom table)
export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  accountTokenColumns({ usedAt: integer("used_at", { mode: "timestamp" }) }),
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
export const userInviteTokens = sqliteTable(
  "user_invite_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expires: integer("expires", { mode: "timestamp" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
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
export const emailVerificationTokens = sqliteTable(
  "email_verification_tokens",
  accountTokenColumns({}),
  t => accountTokenIndexes({ index, uniqueIndex }, "evt", t)
);

// Refresh tokens for custom auth session management
// Stores SHA-256 hashed opaque tokens, enables session revocation and token rotation
export const refreshTokens = sqliteTable(
  "refresh_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SHA-256 hex digest of the opaque refresh token (never store raw tokens)
    tokenHash: text("token_hash").notNull(),
    // Request metadata for session listing and security auditing
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [
    index("refresh_tokens_token_hash_idx").on(t.tokenHash),
    index("refresh_tokens_user_id_idx").on(t.userId),
    index("refresh_tokens_expires_at_idx").on(t.expiresAt),
  ]
);
