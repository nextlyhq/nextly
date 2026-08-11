/**
 * SQLite schema for the email delivery log.
 *
 * See `./postgres.ts` for what this table deliberately does not hold — the
 * recipient's address, the rendered subject, the body — and for why the retry
 * columns are present and inert. SQLite differences: `text` for every string,
 * `integer { mode: "timestamp_ms" }` for datetimes, which keeps the
 * milliseconds the recorder supplies rather than truncating to whole seconds.
 *
 * @module schemas/email-deliveries/sqlite
 */

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import { emailProvidersSqlite } from "../email-providers/sqlite";

export const emailDeliveriesSqlite = sqliteTable(
  "email_deliveries",
  {
    id: text("id").primaryKey(),

    /**
     * `set null` rather than `cascade`: the delivery happened whether or not
     * the provider still exists, and deleting a provider must not erase the
     * evidence of what it sent.
     */
    providerId: text("provider_id").references(() => emailProvidersSqlite.id, {
      onDelete: "set null",
    }),

    providerType: text("provider_type").notNull(),
    templateSlug: text("template_slug"),

    /** SHA-256 of the lowercased, trimmed recipient address, hex encoded. */
    recipientHash: text("recipient_hash").notNull(),

    /** `to`, `cc` or `bcc` — see the PostgreSQL module for why each gets a row. */
    recipientKind: text("recipient_kind").notNull(),

    /** `sent` or `failed`. A drain would add `pending` and `retrying`. */
    status: text("status").notNull(),

    /** Attempts actually made. Always 1 until something retries. */
    attemptCount: integer("attempt_count").notNull().default(1),

    /** Reserved for a drain. Always NULL today — see the PostgreSQL module. */
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }),

    /** Why it failed, with anything address-shaped removed. */
    error: text("error"),

    messageId: text("message_id"),

    /** Reserved and inert — no pass prunes this table. See the PostgreSQL module. */
    retentionClass: text("retention_class").notNull().default("email"),

    /**
     * `timestamp_ms`, not `timestamp`.
     *
     * Drizzle's `timestamp` mode stores whole seconds, so every send inside one
     * second collapses to the same value — and this table appends a row per
     * recipient per send. A newest-first read with a limit would then break
     * ties on the id and return an arbitrary subset rather than the latest
     * sends. The same reason MySQL declares `fsp: 3`.
     */
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
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

export type EmailDeliverySqlite = typeof emailDeliveriesSqlite.$inferSelect;
export type EmailDeliveryInsertSqlite =
  typeof emailDeliveriesSqlite.$inferInsert;
