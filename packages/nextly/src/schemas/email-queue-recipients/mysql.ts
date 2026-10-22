/**
 * `email_queue_recipients` — MySQL definition. The columns are PostgreSQL's
 * (`./postgres.ts`).
 *
 * @module schemas/email-queue-recipients/mysql
 */
// fallow-ignore-file code-duplication

import { index, mysqlTable, primaryKey, varchar } from "drizzle-orm/mysql-core";

import { EMAIL_QUEUE_RECIPIENTS_TABLE } from "./table-name";

export const emailQueueRecipientsMysql = mysqlTable(
  EMAIL_QUEUE_RECIPIENTS_TABLE,
  {
    queuedId: varchar("queued_id", { length: 36 }).notNull(),
    recipientHash: varchar("recipient_hash", { length: 64 }).notNull(),
  },
  t => [
    primaryKey({ columns: [t.queuedId, t.recipientHash] }),
    index("email_queue_recipients_hash_idx").on(t.recipientHash),
  ]
);
