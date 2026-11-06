/**
 * `email_queue_recipients` — SQLite definition. The columns are PostgreSQL's
 * (`./postgres.ts`).
 *
 * @module schemas/email-queue-recipients/sqlite
 */
// fallow-ignore-file code-duplication

import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { EMAIL_QUEUE_RECIPIENTS_TABLE } from "./table-name";

export const emailQueueRecipientsSqlite = sqliteTable(
  EMAIL_QUEUE_RECIPIENTS_TABLE,
  {
    queuedId: text("queued_id").notNull(),
    recipientHash: text("recipient_hash").notNull(),
    recipientKind: text("recipient_kind").notNull(),
  },
  t => [
    primaryKey({ columns: [t.queuedId, t.recipientHash] }),
    index("email_queue_recipients_hash_idx").on(t.recipientHash),
  ]
);
