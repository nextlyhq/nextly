/**
 * PostgreSQL schema for the email delivery log.
 *
 * One row per RECIPIENT per send: which provider carried the message, which
 * template produced it, whether that recipient was accepted, and a hash of the
 * address. Together they answer "did this send", "how many are failing" and
 * "did this person receive it" — the last for someone who was copied as much
 * as for the primary recipient.
 *
 * ## What this table deliberately does not contain
 *
 * **The recipient's address.** Only a keyed hash of it, under the install's
 * own secret. That answers "did this send" and "how many failed" without
 * answering "to whom", and matches what the send path already does — it logs
 * counts, never addresses. Support confirms a delivery by hashing the address
 * they were given, which is the question they are actually asked, and the key
 * is what leaves that query working while a stolen copy of the table cannot be
 * enumerated: an email address has too little entropy for a bare digest to
 * resist a dictionary.
 *
 * This reduces what the table discloses. It does not put the table outside
 * identity-erasure obligations — a keyed hash of a person's address is
 * pseudonymised data, and a request to erase a person still reaches these
 * rows.
 *
 * **Nothing erases them today.** Deleting a user account strips that person
 * from the audit trail and does not touch this table, and no retention pass
 * prunes it, so a row written for someone stays answerable to
 * `list({ recipient })` for as long as the table does. Said here rather than
 * left for a reader to assume otherwise, for the same reason `retention_class`
 * below says it is inert: a column that looks governed and is not is worse
 * than one that plainly is not.
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
     * Keyed SHA-256 of the lowercased, trimmed recipient address, hex encoded.
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
     * much as the primary one.
     *
     * Rows for one message share a `message_id` but NOT necessarily a
     * `status`. SMTP answers `RCPT TO` per address, so a server can accept the
     * message for some recipients and refuse it for others; a refused address
     * is recorded `failed` beside the accepted ones. A provider that reports a
     * single outcome for the whole message gives every row the same status,
     * which is the ordinary case rather than the guaranteed one.
     *
     * No column default. The recorder always supplies this, so a default would
     * only describe rows nothing writes — and the DDL renderer emits a string
     * default unquoted, which SQL rejects outright for a value that is also a
     * keyword.
     */
    recipientKind: varchar("recipient_kind", { length: 3 }).notNull(),

    /**
     * `sent` or `failed`, PER RECIPIENT. A drain would add `pending` and
     * `retrying`.
     */
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

    /**
     * The provider's own id for the message, when it returned one.
     *
     * Unbounded, because the adapter contract accepts any string and a bounded
     * column would make a longer one a write error — which `record()` swallows
     * by design, so a message that WAS dispatched would end up with no row at
     * all. The log must not be the thing that decides a send is unrecordable.
     */
    messageId: text("message_id"),

    /**
     * Which retention window WOULD govern this row.
     *
     * Reserved and inert, like `next_attempt_at` above it: **no pass prunes
     * this table today.** `domains/retention/passes.ts` builds one pass per
     * domain that has retention configured, and email is not among them, so
     * this value is written and never read.
     *
     * Present from the first migration anyway, for the reason the retry
     * columns are: adding it later would be a migration on a table already
     * holding production history. Saying so here rather than letting the
     * column imply otherwise — an operator reading a labelled retention class
     * would reasonably conclude something enforces it, and nothing does.
     */
    retentionClass: varchar("retention_class", { length: 50 }).notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  t => [
    // The unfiltered read — "what happened recently", and the default this
    // service serves. Every other index below leads with a different column,
    // so none of them can order the whole table; without this one the default
    // list degrades to a full scan and sort as the log grows.
    index("email_deliveries_created_idx").on(t.createdAt),
    // "Did this address receive anything, and when" — the support question,
    // answered by hashing the address the operator was given.
    index("email_deliveries_recipient_idx").on(t.recipientHash, t.createdAt),
    // "What is failing right now", and the retention scan, which walks one
    // status oldest-first.
    index("email_deliveries_status_created_idx").on(t.status, t.createdAt),
    // One provider's history, newest first.
    index("email_deliveries_provider_idx").on(t.providerId, t.createdAt),
    // The shape a retention pass needs: one class at a time, oldest first.
    // Present with the column and unused for the same reason.
    index("email_deliveries_retention_idx").on(t.retentionClass, t.createdAt),
  ]
);

export type EmailDeliveryPg = typeof emailDeliveriesPg.$inferSelect;
export type EmailDeliveryInsertPg = typeof emailDeliveriesPg.$inferInsert;
