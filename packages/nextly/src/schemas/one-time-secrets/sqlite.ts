/**
 * `nextly_one_time_secrets`, SQLite. The same columns as PostgreSQL's (see
 * `postgres.ts`), timestamps in Unix seconds as in this dialect's other tables.
 *
 * @module schemas/one-time-secrets/sqlite
 */

import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { ONE_TIME_SECRETS_TABLE } from "./table-name";

export const nextlyOneTimeSecrets = sqliteTable(
  ONE_TIME_SECRETS_TABLE,
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    purpose: text("purpose").notNull(),
    subject: text("subject").notNull(),
    kind: text("kind").notNull(),
    secretHash: text("secret_hash").notNull(),
    liveKey: text("live_key"),
    data: text("data"),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    spentAt: integer("spent_at", { mode: "timestamp" }),
    voidedAt: integer("voided_at", { mode: "timestamp" }),
    wrongTries: integer("wrong_tries").notNull().default(0),
    maxWrongTries: integer("max_wrong_tries"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  table => [
    uniqueIndex("nextly_one_time_secrets_live_key_unique").on(table.liveKey),
    index("nextly_one_time_secrets_hash_idx").on(table.secretHash),
    index("nextly_one_time_secrets_subject_idx").on(table.owner, table.subject),
    index("nextly_one_time_secrets_expires_idx").on(table.expiresAt),
  ]
);
