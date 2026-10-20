/**
 * `email_send_claims` — SQLite definition. See the PostgreSQL module for what
 * each column holds.
 *
 * @module schemas/email-send-claims/sqlite
 */
// fallow-ignore-file code-duplication

import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { EMAIL_SEND_CLAIMS_TABLE } from "./table-name";

export const emailSendClaimsSqlite = sqliteTable(
  EMAIL_SEND_CLAIMS_TABLE,
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull(),
    keyDigest: text("key_digest").notNull(),
    messageDigest: text("message_digest").notNull(),
    state: text("state").notNull(),
    holder: text("holder").notNull(),
    result: text("result"),
    claimedAt: integer("claimed_at").notNull(),
    leaseExpiresAt: integer("lease_expires_at").notNull(),
    settledAt: integer("settled_at"),
  },
  t => [
    uniqueIndex("email_send_claims_key_idx").on(t.scope, t.keyDigest),
    index("email_send_claims_state_idx").on(t.state, t.settledAt),
    index("email_send_claims_lease_idx").on(t.leaseExpiresAt),
  ]
);
