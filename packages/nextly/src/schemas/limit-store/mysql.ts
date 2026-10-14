/**
 * `nextly_limit_store` — the database limit store's entries, MySQL.
 *
 * See `./postgres.ts` for what each column holds. `id` is lowercase hex or a
 * `capacity:` counter name, so the default case-insensitive collation compares
 * it exactly, and 64 characters index well within InnoDB's key limit.
 *
 * @module schemas/limit-store/mysql
 */

import {
  bigint,
  index,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core";

import { LIMIT_STORE_TABLE } from "./table-name";

// The same table in another dialect's Drizzle builders: each dialect's
// column functions are distinct, so the declarations cannot be shared.
// fallow-ignore-next-line code-duplication
export const nextlyLimitStore = mysqlTable(
  LIMIT_STORE_TABLE,
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    value: text("value"),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    generation: varchar("generation", { length: 32 }).notNull(),
  },
  t => [
    index("nls_expires_at_idx").on(t.expiresAt),
    index("nls_generation_idx").on(t.generation),
  ]
);
