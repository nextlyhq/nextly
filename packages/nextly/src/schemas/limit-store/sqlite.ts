/**
 * `nextly_limit_store` — the database limit store's entries, SQLite.
 *
 * See `./postgres.ts` for what each column holds. `expires_at` is an integer
 * of milliseconds, not `mode: "timestamp"` seconds: windows and waits are
 * timed to the millisecond on every dialect.
 *
 * @module schemas/limit-store/sqlite
 */

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { LIMIT_STORE_TABLE } from "./table-name";

export const nextlyLimitStore = sqliteTable(
  LIMIT_STORE_TABLE,
  {
    id: text("id").primaryKey(),
    value: text("value"),
    expiresAt: integer("expires_at").notNull(),
    generation: text("generation").notNull(),
  },
  t => [
    index("nls_expires_at_idx").on(t.expiresAt),
    index("nls_generation_idx").on(t.generation),
  ]
);
