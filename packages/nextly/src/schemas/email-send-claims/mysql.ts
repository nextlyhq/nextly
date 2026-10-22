/**
 * `email_send_claims` — MySQL. Mirrors `./postgres.ts`; see it for what each
 * column holds.
 *
 * @module schemas/email-send-claims/mysql
 */
// fallow-ignore-file code-duplication

import {
  bigint,
  index,
  longtext,
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
    scope: text("scope").notNull(),
    keyDigest: varchar("key_digest", { length: 64 }),
    messageDigest: varchar("message_digest", { length: 64 }),
    state: varchar("state", { length: 16 }).notNull(),
    holder: varchar("holder", { length: 36 }).notNull(),
    // `longtext`: a result lists every refused copy, and `text` stops at 64 KB.
    result: longtext("result"),
    claimedAt: bigint("claimed_at", { mode: "number" }).notNull(),
    leaseExpiresAt: bigint("lease_expires_at", { mode: "number" }).notNull(),
    settledAt: bigint("settled_at", { mode: "number" }),
  },
  t => [
    uniqueIndex("email_send_claims_key_idx").on(t.keyDigest),
    index("email_send_claims_state_idx").on(t.state, t.settledAt),
    index("email_send_claims_lease_idx").on(t.leaseExpiresAt),
  ]
);
