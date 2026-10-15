/**
 * `nextly_one_time_secrets`, MySQL. The same columns as PostgreSQL's (see
 * `postgres.ts`); every column an index reads is bounded, because MySQL cannot
 * index a TEXT column without a prefix length.
 *
 * @module schemas/one-time-secrets/mysql
 */

import {
  index,
  int,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { ONE_TIME_SECRETS_TABLE } from "./table-name";

export const nextlyOneTimeSecrets = mysqlTable(
  ONE_TIME_SECRETS_TABLE,
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    // Unbounded, as a plugin's name is: nothing is indexed or compared on it
    // alone, so it needs no width a long name could exceed.
    owner: text("owner").notNull(),
    purpose: varchar("purpose", { length: 64 }).notNull(),
    // 255 is the bound the helper enforces on a subject.
    subject: varchar("subject", { length: 255 }).notNull(),
    // SHA-256 hex of the plugin and subject. Lower-case hex compares exactly
    // under any collation, where the subject itself would not: the default
    // matches "Alice" to "alice".
    subjectKey: varchar("subject_key", { length: 64 }).notNull(),
    kind: varchar("kind", { length: 8 }).notNull(),
    secretHash: varchar("secret_hash", { length: 64 }).notNull(),
    liveKey: varchar("live_key", { length: 64 }),
    issueSeq: int("issue_seq"),
    data: text("data"),
    expiresAt: timestamp("expires_at").notNull(),
    spentAt: timestamp("spent_at"),
    voidedAt: timestamp("voided_at"),
    wrongTries: int("wrong_tries").notNull().default(0),
    maxWrongTries: int("max_wrong_tries"),
    createdAt: timestamp("created_at").notNull(),
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
