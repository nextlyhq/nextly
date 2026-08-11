/**
 * PostgreSQL schema for the email delivery log.
 *
 * Records that a message was attempted and what happened to it. A failed
 * password-reset previously left no trace at all — the adapter threw, the
 * service turned it into `{ success: false }`, one log line was written, and
 * that was the entire record. The operator learned from the user.
 *
 * ## What this table deliberately does not contain
 *
 * **The recipient's address.** Only a hash of it. That answers "did this send"
 * and "how many failed" without answering "to whom", keeps the table outside
 * the identity-erasure obligations that govern anything holding a person's
 * address, and matches what the send path already does — it logs counts, never
 * addresses. Support confirms a delivery by hashing the address they were
 * given, which is the question they are actually asked.
 *
 * **The rendered subject.** The template SLUG is recorded instead. A slug says
 * which kind of message this was, is stable across copy edits, and cannot carry
 * a name — while a rendered subject is the single field in a message most
 * likely to interpolate one. A raw send with no template records no slug, and
 * the row still answers the question it exists for.
 *
 * **The message body.** Never, in any form.
 *
 * ## The retry columns are reserved and inert
 *
 * `status`, `attempt_count` and `next_attempt_at` exist from the first
 * migration so that adding a drain later is not a migration on a table already
 * holding production history. **Nothing drains this table today.**
 *
 * That distinction is load-bearing rather than pedantic, because a schema is
 * read by more than the code that writes it. `next_attempt_at` is therefore
 * always NULL: a timestamp in that column asserts that something will happen at
 * that time, and an operator reading a failed row with a retry fifteen minutes
 * out would wait for an attempt no code will ever make. A NULL is honestly
 * empty; a populated column is a promise. `attempt_count` records attempts that
 * actually happened, which is a fact rather than a promise, and is 1 for every
 * row a log-only writer produces.
 *
 * @module schemas/email-deliveries/postgres
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

import { emailProvidersPg } from "../email-providers/postgres";

export const emailDeliveriesPg = pgTable(
  "email_deliveries",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),

    /**
     * The provider that carried the message, when one is still stored.
     *
     * `set null` rather than `cascade`: the delivery happened whether or not
     * the provider still exists, and deleting a provider must not erase the
     * evidence of what it sent. `provider_type` below is what survives.
     */
    providerId: uuid("provider_id").references(() => emailProvidersPg.id, {
      onDelete: "set null",
    }),

    /**
     * The registered type, denormalized so the row stays meaningful after the
     * provider is deleted or its plugin uninstalled.
     */
    providerType: varchar("provider_type", { length: 50 }).notNull(),

    /** Which template produced this, when one did. Never the rendered text. */
    templateSlug: varchar("template_slug", { length: 255 }),

    /**
     * SHA-256 of the lowercased, trimmed recipient address, hex encoded.
     *
     * Fixed width, so `char`-like sizing is honest; `varchar(64)` keeps the
     * three dialects aligned without a dialect-specific type.
     */
    recipientHash: varchar("recipient_hash", { length: 64 }).notNull(),

    /**
     * How this recipient received the message: `to`, `cc` or `bcc`.
     *
     * One row per recipient, because the table's whole purpose is to answer
     * "did this person receive it", and a copied recipient received it just as
     * much as the primary one. Rows for a single message share a `message_id`
     * and a `status`, which is honest rather than lossy: the provider returns
     * one result for the message, not one per address.
     *
     * No column default. The recorder always supplies this, so a default would
     * only describe rows nothing writes — and the DDL renderer emits a string
     * default unquoted, which SQL rejects outright for a value that is also a
     * keyword.
     */
    recipientKind: varchar("recipient_kind", { length: 3 }).notNull(),

    /** `sent` or `failed`. A drain would add `pending` and `retrying`. */
    status: varchar("status", { length: 20 }).notNull(),

    /** Attempts actually made. Always 1 until something retries. */
    attemptCount: integer("attempt_count").notNull().default(1),

    /** Reserved for a drain. Always NULL today — see the module comment. */
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),

    /**
     * Why it failed, with anything address-shaped removed.
     *
     * An SMTP rejection quotes the recipient back at you — `550 5.1.1
     * <someone@example.com> User unknown` — so storing a provider's message
     * verbatim would reintroduce the address this table hashes to avoid
     * holding, in the column right beside the hash.
     */
    error: text("error"),

    /** The provider's own id for the message, when it returned one. */
    messageId: varchar("message_id", { length: 255 }),

    /**
     * Which retention window governs this row. Present from the first
     * migration for the same reason the retry columns are: adding it later
     * would be a migration on a table already holding history.
     */
    retentionClass: varchar("retention_class", { length: 50 })
      .notNull()
      .default("email"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => [
    // "Did this address receive anything, and when" — the support question,
    // answered by hashing the address the operator was given.
    index("email_deliveries_recipient_idx").on(t.recipientHash, t.createdAt),
    // "What is failing right now", and the retention scan, which walks one
    // status oldest-first.
    index("email_deliveries_status_created_idx").on(t.status, t.createdAt),
    // One provider's history, newest first.
    index("email_deliveries_provider_idx").on(t.providerId, t.createdAt),
    // Retention prunes one class at a time, oldest first.
    index("email_deliveries_retention_idx").on(t.retentionClass, t.createdAt),
  ]
);

export type EmailDeliveryPg = typeof emailDeliveriesPg.$inferSelect;
export type EmailDeliveryInsertPg = typeof emailDeliveriesPg.$inferInsert;
