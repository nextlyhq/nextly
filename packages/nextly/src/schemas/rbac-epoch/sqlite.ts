/**
 * `nextly_rbac_epoch` — how many times RBAC has changed, SQLite.
 *
 * See `./postgres.ts` for what the table is, why it holds one row under a fixed
 * key, and why it is a table rather than a column on the cache rows.
 *
 * @module schemas/rbac-epoch/sqlite
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { RBAC_EPOCH_TABLE } from "./table-name";

export const nextlyRbacEpoch = sqliteTable(RBAC_EPOCH_TABLE, {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull(),
  generation: text("generation").notNull(),
  // Unix seconds, as every other timestamp in this dialect's tables.
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
