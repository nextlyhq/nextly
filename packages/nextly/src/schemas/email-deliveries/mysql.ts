/**
 * MySQL schema for the email delivery log.
 *
 * See `./postgres.ts` for what this table deliberately does not hold — the
 * recipient's address, the rendered subject, the body — and for why the retry
 * columns are present and inert. MySQL differences: `varchar(36)` ids,
 * `datetime` for timestamps.
 *
 * @module schemas/email-deliveries/mysql
 */

import {
  mysqlTable,
  varchar,
  text,
  int,
  datetime,
  index,
} from "drizzle-orm/mysql-core";

export const emailDeliveriesMysql = mysqlTable(
  "email_deliveries",
  {
    id: varchar("id", { length: 36 }).primaryKey(),

    /**
     * No foreign key, unlike PostgreSQL and SQLite.
     *
     * Which means a deleted provider leaves this pointing at a row that is
     * gone, rather than being nulled. That is stated plainly because an earlier
     * version of this comment claimed the service nulls it, and no code does —
     * a comment describing behaviour that does not exist is worse than none,
     * since the next reader stops looking.
     *
     * It is survivable rather than correct: `provider_type` beside it keeps
     * every row meaningful without the join, and no read path follows this id
     * expecting a row. Making the three dialects agree is filed rather than
     * done here, because the honest fix is the service nulling it on delete on
     * every dialect, not a foreign key on one more.
     */
    providerId: varchar("provider_id", { length: 36 }),

    providerType: varchar("provider_type", { length: 50 }).notNull(),
    templateSlug: varchar("template_slug", { length: 255 }),

    /** SHA-256 of the lowercased, trimmed recipient address, hex encoded. */
    recipientHash: varchar("recipient_hash", { length: 64 }).notNull(),

    /** `sent` or `failed`. A drain would add `pending` and `retrying`. */
    status: varchar("status", { length: 20 }).notNull(),

    /** Attempts actually made. Always 1 until something retries. */
    attemptCount: int("attempt_count").notNull().default(1),

    /** Reserved for a drain. Always NULL today — see the PostgreSQL module. */
    nextAttemptAt: datetime("next_attempt_at"),

    /** Why it failed, with anything address-shaped removed. */
    error: text("error"),

    messageId: varchar("message_id", { length: 255 }),

    retentionClass: varchar("retention_class", { length: 50 })
      .notNull()
      .default("email"),

    createdAt: datetime("created_at").notNull(),
  },
  t => [
    index("email_deliveries_recipient_idx").on(t.recipientHash, t.createdAt),
    index("email_deliveries_status_created_idx").on(t.status, t.createdAt),
    index("email_deliveries_provider_idx").on(t.providerId, t.createdAt),
    index("email_deliveries_retention_idx").on(t.retentionClass, t.createdAt),
  ]
);

export type EmailDeliveryMysql = typeof emailDeliveriesMysql.$inferSelect;
export type EmailDeliveryInsertMysql = typeof emailDeliveriesMysql.$inferInsert;
