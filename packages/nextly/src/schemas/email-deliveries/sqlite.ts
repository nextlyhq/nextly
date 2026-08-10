/**
 * SQLite schema for the email delivery log.
 *
 * See `./postgres.ts` for what this table deliberately does not hold — the
 * recipient's address, the rendered subject, the body — and for why the retry
 * columns are present and inert. SQLite differences: `text` for every string,
 * `integer { mode: "timestamp" }` for datetimes.
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

    /** `sent` or `failed`. A drain would add `pending` and `retrying`. */
    status: text("status").notNull(),

    /** Attempts actually made. Always 1 until something retries. */
    attemptCount: integer("attempt_count").notNull().default(1),

    /** Reserved for a drain. Always NULL today — see the PostgreSQL module. */
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }),

    /** Why it failed, with anything address-shaped removed. */
    error: text("error"),

    messageId: text("message_id"),

    retentionClass: text("retention_class").notNull().default("email"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [
    index("email_deliveries_recipient_idx").on(t.recipientHash, t.createdAt),
    index("email_deliveries_status_created_idx").on(t.status, t.createdAt),
    index("email_deliveries_provider_idx").on(t.providerId, t.createdAt),
    index("email_deliveries_retention_idx").on(t.retentionClass, t.createdAt),
  ]
);

export type EmailDeliverySqlite = typeof emailDeliveriesSqlite.$inferSelect;
export type EmailDeliveryInsertSqlite =
  typeof emailDeliveriesSqlite.$inferInsert;
