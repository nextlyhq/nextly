/**
 * Auth-token tables — PostgreSQL.
 *
 * Tables: emailVerificationTokens, passwordResetTokens, refreshTokens.
 * Moved verbatim from packages/nextly/src/database/schema/postgres.ts as part
 * of Plan A schemas consolidation. No behavior change.
 *
 * Drizzle v2 relations for this feature live centrally in
 * `../_dialect-bundles/postgres.relations.ts` (defineRelations).
 * (`users`). Re-exported at the bottom so namespace consumers see them.
 *
 * @module schemas/auth-tokens/postgres
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import type { ColumnBuilderBase } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  timestamp,
  index,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "../users/postgres";

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
    id: serial("id").primaryKey(),
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
    expires: timestamp("expires", { withTimezone: false }).notNull(),
    ...extra,
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  };
}

// Password reset tokens (custom table)
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  accountTokenColumns({
    usedAt: timestamp("used_at", { withTimezone: false }),
  }),
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
export const userInviteTokens = pgTable(
  "user_invite_tokens",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expires: timestamp("expires", { withTimezone: false }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: false }),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
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
export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  accountTokenColumns({}),
  t => accountTokenIndexes({ index, uniqueIndex }, "evt", t)
);

// Refresh tokens for custom auth session management
// Stores SHA-256 hashed opaque tokens, enables session revocation and token rotation
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SHA-256 hex digest of the opaque refresh token (never store raw tokens)
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    // Request metadata for session listing and security auditing
    userAgent: text("user_agent"),
    ipAddress: varchar("ip_address", { length: 45 }),
    expiresAt: timestamp("expires_at", { withTimezone: false }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    // Primary lookup: hash incoming token and query by tokenHash
    index("refresh_tokens_token_hash_idx").on(t.tokenHash),
    // Cleanup all tokens for a user on password change or logout-all
    index("refresh_tokens_user_id_idx").on(t.userId),
    // Cleanup expired tokens efficiently
    index("refresh_tokens_expires_at_idx").on(t.expiresAt),
  ]
);
