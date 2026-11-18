/**
 * `email_queue` — PostgreSQL definition.
 *
 * One row per email queued through `queue` or `queueWithTemplate`: what is
 * sent, held until it is, and where its attempts stand. The job that makes
 * the attempts carries only this row's id, so the jobs table holds nothing
 * of the message.
 *
 * The message is sealed under the install's secret (`queued-send.ts`), never
 * held in clear. Times are epoch milliseconds, compared as numbers on every
 * dialect.
 *
 * @module schemas/email-queue/postgres
 */

import { bigint, index, pgTable, text, varchar } from "drizzle-orm/pg-core";

import { EMAIL_QUEUE_TABLE } from "./table-name";

export const emailQueuePg = pgTable(
  EMAIL_QUEUE_TABLE,
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    /**
     * Who queued it: `site`, `core`, or `plugin:<name>`, the scope its
     * idempotency key is claimed in. Never chosen by a caller, and unbounded,
     * as a plugin's name is.
     */
    scope: text("scope").notNull(),
    /** `waiting`, `sending`, `sent`, `failed` or `cancelled`. */
    state: varchar("state", { length: 16 }).notNull(),
    /** The job that makes its attempts; none for one stored cancelled. */
    jobId: varchar("job_id", { length: 36 }),
    /** The message, sealed: addresses, content and every send option. */
    message: text("message"),
    /**
     * The person `to` is, by kind and id, as the delivery records name them,
     * so their deletion cancels the email. Their digest in place of the id
     * once they are deleted.
     */
    principalKind: varchar("principal_kind", { length: 191 }),
    principalId: varchar("principal_id", { length: 191 }),
    /** The last failed attempt's failure, as JSON, with no address. */
    failure: text("failure"),
    /**
     * The template it is sent from, in clear so the Activity list can show
     * and filter by it: a slug names a kind of message, never a person. Null
     * for a message queued without a template, and for one queued before
     * this column existed.
     */
    templateSlug: varchar("template_slug", { length: 255 }),
    /**
     * What was queued, in clear for the Activity: `message` or `template`,
     * and the kinds of recipient it goes to (`to`, `cc`, `bcc`, comma
     * separated), never an address. Null for one queued before these were
     * recorded.
     */
    messageKind: varchar("message_kind", { length: 16 }),
    recipientKinds: varchar("recipient_kinds", { length: 16 }),
    /**
     * The provider its latest attempt went through, as its delivery records
     * name it: null until an attempt is made.
     */
    providerType: varchar("provider_type", { length: 50 }),
    providerId: varchar("provider_id", { length: 36 }),
    providerOrigin: varchar("provider_origin", { length: 16 }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    /** When it was sent, failed for good, or was cancelled. */
    settledAt: bigint("settled_at", { mode: "number" }),
  },
  t => [
    index("email_queue_state_idx").on(t.state, t.settledAt),
    index("email_queue_principal_idx").on(t.principalKind, t.principalId),
    // The Activity list: newest first, by cursor, and by template.
    index("email_queue_created_idx").on(t.createdAt, t.id),
    index("email_queue_template_idx").on(t.templateSlug, t.createdAt),
  ]
);
