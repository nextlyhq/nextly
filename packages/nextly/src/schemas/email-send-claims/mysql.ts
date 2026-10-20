/**
 * `email_send_claims` — MySQL definition.
 *
 * One row per idempotency key a caller has sent with: the claim core takes
 * before contacting a provider, so a send that carries a key reaches the
 * provider once however often it is repeated.
 *
 * Holds keyed digests and no address. The key is digested with its caller's
 * scope, the message as everything that reaches the provider, and the first
 * send's result carries recipients by position only. Times are epoch
 * milliseconds, compared as numbers on every dialect.
 *
 * @module schemas/email-send-claims/mysql
 */

import {
  bigint,
  index,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { EMAIL_SEND_CLAIMS_TABLE } from "./table-name";

export const emailSendClaimsMysql = mysqlTable(
  EMAIL_SEND_CLAIMS_TABLE,
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    /** Who sent: `site`, `core`, or `plugin:<name>`. Never chosen by a caller. */
    scope: varchar("scope", { length: 191 }).notNull(),
    /** Keyed digest of the scope and key, as the delivery records carry it. */
    keyDigest: varchar("key_digest", { length: 64 }).notNull(),
    /** Keyed digest of the message, to refuse a key reused for another. */
    messageDigest: varchar("message_digest", { length: 64 }).notNull(),
    /** `claimed`, `sent` or `failed`. */
    state: varchar("state", { length: 16 }).notNull(),
    /** The attempt holding the claim, so only it can settle it. */
    holder: varchar("holder", { length: 36 }).notNull(),
    /** The first successful send's result, as JSON, with no address. */
    result: text("result"),
    claimedAt: bigint("claimed_at", { mode: "number" }).notNull(),
    /** After this a claim with no outcome may be taken over. */
    leaseExpiresAt: bigint("lease_expires_at", { mode: "number" }).notNull(),
    /** When the outcome was recorded; the lifetime of a sent claim runs from it. */
    settledAt: bigint("settled_at", { mode: "number" }),
  },
  t => [
    // What decides a race: two sends with one key insert one row.
    uniqueIndex("email_send_claims_key_idx").on(t.scope, t.keyDigest),
    index("email_send_claims_state_idx").on(t.state, t.settledAt),
    index("email_send_claims_lease_idx").on(t.leaseExpiresAt),
  ]
);
