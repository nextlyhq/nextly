/**
 * `nextly_rbac_epoch` — how many times RBAC has changed, MySQL.
 *
 * See `./postgres.ts` for what the table is, why it holds one row under a fixed
 * key, and why it is a table rather than a column on the cache rows.
 *
 * @module schemas/rbac-epoch/mysql
 */

import { bigint, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";

export const nextlyRbacEpoch = mysqlTable("nextly_rbac_epoch", {
  id: varchar("id", { length: 32 }).primaryKey(),
  revision: bigint("revision", { mode: "number" }).notNull(),
  generation: varchar("generation", { length: 64 }).notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});
