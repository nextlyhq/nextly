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
     * A deleted provider therefore leaves this pointing at a row that is gone,
     * rather than being nulled: nothing in the service clears it, and there is
     * no constraint here to do it instead.
     *
     * Readers must not assume it resolves. `provider_type` beside it keeps
     * every row meaningful without the join, and no read path follows this id
     * expecting to find a provider.
     */
    providerId: varchar("provider_id", { length: 36 }),

    providerType: varchar("provider_type", { length: 50 }).notNull(),
    templateSlug: varchar("template_slug", { length: 255 }),

    /** SHA-256 of the lowercased, trimmed recipient address, hex encoded. */
    recipientHash: varchar("recipient_hash", { length: 64 }).notNull(),

    /** `to`, `cc` or `bcc` — see the PostgreSQL module for why each gets a row. */
    recipientKind: varchar("recipient_kind", { length: 3 }).notNull(),

    /** `sent` or `failed`. A drain would add `pending` and `retrying`. */
    status: varchar("status", { length: 20 }).notNull(),

    /** Attempts actually made. Always 1 until something retries. */
    attemptCount: int("attempt_count").notNull().default(1),

    /** Reserved for a drain. Always NULL today — see the PostgreSQL module. */
    nextAttemptAt: datetime("next_attempt_at", { fsp: 3 }),

    /** Why it failed, with anything address-shaped removed. */
    error: text("error"),

    /** Unbounded — see the PostgreSQL module. A bounded column loses rows. */
    messageId: text("message_id"),

    /** Reserved and inert — no pass prunes this table. See the PostgreSQL module. */
    retentionClass: varchar("retention_class", { length: 50 })
      .notNull()
      .default("email"),

    /**
     * `fsp: 3` — milliseconds, not whole seconds.
     *
     * A bare MySQL `datetime` truncates to the second, and this table appends
     * one row per recipient per send. Several messages within one second would
     * store an identical timestamp, and a newest-first read with a limit would
     * then break the tie on whatever the index happened to return — an
     * arbitrary subset rather than the latest sends. PostgreSQL and SQLite
     * already keep sub-second precision.
     */
    createdAt: datetime("created_at", { fsp: 3 }).notNull(),
  },
  t => [
    // The unfiltered read — "what happened recently", and the default this
    // service serves. Every other index below leads with a different column,
    // so none of them can order the whole table; without this one the default
    // list degrades to a full scan and sort as the log grows.
    index("email_deliveries_created_idx").on(t.createdAt),
    index("email_deliveries_recipient_idx").on(t.recipientHash, t.createdAt),
    index("email_deliveries_status_created_idx").on(t.status, t.createdAt),
    index("email_deliveries_provider_idx").on(t.providerId, t.createdAt),
    index("email_deliveries_retention_idx").on(t.retentionClass, t.createdAt),
  ]
);

export type EmailDeliveryMysql = typeof emailDeliveriesMysql.$inferSelect;
export type EmailDeliveryInsertMysql = typeof emailDeliveriesMysql.$inferInsert;
