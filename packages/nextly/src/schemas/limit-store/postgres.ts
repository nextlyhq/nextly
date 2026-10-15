/**
 * `nextly_limit_store` — the database limit store's entries, PostgreSQL.
 *
 * One row per key a limit counts. `id` is the SHA-256 of the key, in hex,
 * rather than the key: a fixed width every dialect indexes, compared byte for
 * byte whatever collation the database uses, and holding nothing a limit was
 * keyed on. `value` is the limit's own JSON; `null` marks a row an update has
 * claimed but not written, which never outlives that update's transaction.
 * `expires_at` is milliseconds since the epoch on the database's clock.
 * `generation` names the install secret the entry was written under, so the
 * entries of a rotated-out secret can be removed rather than counted.
 *
 * A row whose id starts with `capacity:` is the count of entries held under
 * one generation, kept so an update can tell whether the store has room
 * without counting the table.
 *
 * @module schemas/limit-store/postgres
 */

import { bigint, index, pgTable, text, varchar } from "drizzle-orm/pg-core";

import { LIMIT_STORE_TABLE } from "./table-name";

// The same table in another dialect's Drizzle builders: each dialect's
// column functions are distinct, so the declarations cannot be shared.
// fallow-ignore-next-line code-duplication
export const nextlyLimitStore = pgTable(
  LIMIT_STORE_TABLE,
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    value: text("value"),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    generation: varchar("generation", { length: 32 }).notNull(),
  },
  t => [
    // The sweep finds expired entries by this.
    index("nls_expires_at_idx").on(t.expiresAt),
    // And entries of a rotated-out secret by this.
    index("nls_generation_idx").on(t.generation),
  ]
);
