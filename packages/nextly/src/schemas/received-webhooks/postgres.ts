/**
 * `nextly_received_webhooks`: the webhooks plugins have received, one row per
 * plugin, provider and delivery, PostgreSQL.
 *
 * The canonical column list; `./mysql.ts` and `./sqlite.ts` mirror it with
 * their own types. A row is a claim on one delivery: `pending` while a
 * handler holds its lease, `completed` once the delivery was processed. The
 * primary key is a SHA-256 hex of the plugin, provider and delivery, so a
 * delivery is claimed once and every dialect compares it exactly, whatever
 * its collation. No payload is stored.
 *
 * @module schemas/received-webhooks/postgres
 */
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { RECEIVED_WEBHOOKS_TABLE } from "./table-name";

export const nextlyReceivedWebhooks = pgTable(
  RECEIVED_WEBHOOKS_TABLE,
  {
    /** SHA-256 hex of the plugin, provider and delivery: the claim's key. */
    deliveryKey: text("delivery_key").primaryKey(),
    /** The plugin's name, as declared in its manifest. */
    owner: text("owner").notNull(),
    /** The sender, in the plugin's own words, such as `stripe`. */
    provider: text("provider").notNull(),
    /** The delivery's id as given, for diagnosis; null when keyed by body. */
    deliveryId: text("delivery_id"),
    /** `checked` or `unchecked`: whether the delivery's age was checked. */
    freshness: text("freshness").notNull(),
    /** `pending` while a handler holds the lease, then `completed`. */
    status: text("status").notNull(),
    /** The current holder's token: only it completes or releases the claim. */
    claimToken: text("claim_token").notNull(),
    /** When a pending claim's lease ends; null once completed. */
    leaseUntil: timestamp("lease_until", { withTimezone: false }),
    receivedAt: timestamp("received_at", { withTimezone: false }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: false }),
    /**
     * What pruning reads: the completion for a processed delivery, the lease's
     * end for a pending one. One indexed column, so the sweep never scans.
     */
    pruneAt: timestamp("prune_at", { withTimezone: false }).notNull(),
  },
  table => [index("nextly_received_webhooks_prune_idx").on(table.pruneAt)]
);
