/**
 * `nextly_one_time_secrets`: one-purpose links and codes plugins mint,
 * PostgreSQL.
 *
 * A secret is stored only as an HMAC (`secret_hash`), never as itself, under a
 * key derived from the install's secret. Spending, voiding and a wrong code's
 * charge are conditional updates of one row, so on every instance exactly one
 * caller wins.
 *
 * `live_key` holds a hash of the plugin, purpose and subject while a CODE is
 * live, and is null otherwise. Its unique index is what keeps at most one
 * live code per plugin, purpose and subject even when two mints run at once:
 * the second insert meets the first's key. Null in every other row, which a
 * unique index admits any number of on all three dialects.
 *
 * @module schemas/one-time-secrets/postgres
 */

import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { ONE_TIME_SECRETS_TABLE } from "./table-name";

export const nextlyOneTimeSecrets = pgTable(
  ONE_TIME_SECRETS_TABLE,
  {
    id: text("id").primaryKey(),
    /** The plugin's name, as declared in its manifest. */
    owner: text("owner").notNull(),
    /** The plugin's purpose, within its own namespace. */
    purpose: text("purpose").notNull(),
    /** What the secret is for: the plugin's choice, such as an account id. */
    subject: text("subject").notNull(),
    /**
     * SHA-256 of the plugin and subject, hex: what a subject's secrets are
     * found by, so every dialect compares them exactly (MySQL's default
     * collation would match "Alice" to "alice").
     */
    subjectKey: text("subject_key").notNull(),
    /** `token` (a link) or `code` (typed). */
    kind: text("kind").notNull(),
    /** HMAC-SHA-256 of the secret, hex. */
    secretHash: text("secret_hash").notNull(),
    /** Set while a code is live; see the module comment. */
    liveKey: text("live_key"),
    /**
     * A code's issue number among its plugin, purpose and subject's codes:
     * what its status is read by, as issue times can tie. Null for a token.
     */
    issueSeq: integer("issue_seq"),
    /** The plugin's data, JSON, stored in clear. */
    data: text("data"),
    expiresAt: timestamp("expires_at", { withTimezone: false }).notNull(),
    spentAt: timestamp("spent_at", { withTimezone: false }),
    voidedAt: timestamp("voided_at", { withTimezone: false }),
    /** A code's wrong tries so far, and the most it may take. */
    wrongTries: integer("wrong_tries").notNull().default(0),
    maxWrongTries: integer("max_wrong_tries"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull(),
  },
  table => [
    uniqueIndex("nextly_one_time_secrets_live_key_unique").on(table.liveKey),
    uniqueIndex("nextly_one_time_secrets_issue_unique").on(
      table.subjectKey,
      table.purpose,
      table.kind,
      table.issueSeq
    ),
    index("nextly_one_time_secrets_hash_idx").on(table.secretHash),
    index("nextly_one_time_secrets_subject_key_idx").on(table.subjectKey),
    index("nextly_one_time_secrets_expires_idx").on(table.expiresAt),
  ]
);
