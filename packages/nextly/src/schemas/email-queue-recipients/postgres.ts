/**
 * `email_queue_recipients` — PostgreSQL definition.
 *
 * One row per address a queued email goes to (`to`, `cc` and `bcc`), as the
 * keyed digest the delivery records carry, never the address: what erasing
 * an address finds a queued email by. Removed with the email's message.
 *
 * @module schemas/email-queue-recipients/postgres
 */

import { index, pgTable, primaryKey, varchar } from "drizzle-orm/pg-core";

import { EMAIL_QUEUE_RECIPIENTS_TABLE } from "./table-name";

export const emailQueueRecipientsPg = pgTable(
  EMAIL_QUEUE_RECIPIENTS_TABLE,
  {
    /** The queued email, `email_queue.id`. */
    queuedId: varchar("queued_id", { length: 36 }).notNull(),
    /** Keyed digest of the address, as `recipientDigest` makes it. */
    recipientHash: varchar("recipient_hash", { length: 64 }).notNull(),
  },
  t => [
    primaryKey({ columns: [t.queuedId, t.recipientHash] }),
    index("email_queue_recipients_hash_idx").on(t.recipientHash),
  ]
);
