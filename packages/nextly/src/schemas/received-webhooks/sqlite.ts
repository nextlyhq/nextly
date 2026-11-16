/**
 * `nextly_received_webhooks`, SQLite. The same columns as PostgreSQL's (see
 * `postgres.ts`), with times in whole seconds. The boot DDL in
 * `database/sqlite-core-tables.ts` matches it.
 *
 * @module schemas/received-webhooks/sqlite
 */

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { RECEIVED_WEBHOOKS_TABLE } from "./table-name";

export const nextlyReceivedWebhooks = sqliteTable(
  RECEIVED_WEBHOOKS_TABLE,
  {
    deliveryKey: text("delivery_key").primaryKey(),
    owner: text("owner").notNull(),
    provider: text("provider").notNull(),
    deliveryId: text("delivery_id"),
    freshness: text("freshness").notNull(),
    status: text("status").notNull(),
    claimToken: text("claim_token").notNull(),
    leaseUntil: integer("lease_until", { mode: "timestamp" }),
    receivedAt: integer("received_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    pruneAt: integer("prune_at", { mode: "timestamp" }).notNull(),
  },
  table => [index("nextly_received_webhooks_prune_idx").on(table.pruneAt)]
);
