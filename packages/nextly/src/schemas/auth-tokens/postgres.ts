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

// Password reset tokens (custom table)
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: serial("id").primaryKey(),
    identifier: text("identifier").notNull(),
    tokenHash: text("token_hash").notNull(),
    expires: timestamp("expires", { withTimezone: false }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: false }),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
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

// Email verification tokens (custom, hashed) to avoid storing raw tokens
export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: serial("id").primaryKey(),
    identifier: text("identifier").notNull(),
    tokenHash: text("token_hash").notNull(),
    expires: timestamp("expires", { withTimezone: false }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
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
