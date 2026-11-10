/**
 * `nextly_received_webhooks`, MySQL. The same columns as PostgreSQL's (see
 * `postgres.ts`); every column a key or an index reads is bounded, because
 * MySQL cannot index a TEXT column without a prefix length.
 *
 * @module schemas/received-webhooks/mysql
 */

import {
  index,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

import { RECEIVED_WEBHOOKS_TABLE } from "./table-name";

export const nextlyReceivedWebhooks = mysqlTable(
  RECEIVED_WEBHOOKS_TABLE,
  {
    // Lower-case SHA-256 hex, which compares exactly under any collation,
    // where a provider's own id would not: the default matches "A" to "a".
    deliveryKey: varchar("delivery_key", { length: 64 }).primaryKey(),
    // Unbounded, as a plugin's name is: nothing is indexed on it.
    owner: text("owner").notNull(),
    // 191 is the bound the helper enforces on a provider and an id.
    provider: varchar("provider", { length: 191 }).notNull(),
    deliveryId: varchar("delivery_id", { length: 191 }),
    freshness: varchar("freshness", { length: 16 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    claimToken: varchar("claim_token", { length: 36 }).notNull(),
    leaseUntil: timestamp("lease_until"),
    receivedAt: timestamp("received_at").notNull(),
    completedAt: timestamp("completed_at"),
    pruneAt: timestamp("prune_at").notNull(),
  },
  table => [index("nextly_received_webhooks_prune_idx").on(table.pruneAt)]
);
