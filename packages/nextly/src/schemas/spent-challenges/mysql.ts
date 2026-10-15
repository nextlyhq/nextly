/**
 * `nextly_spent_challenges` — two-factor challenges already answered, MySQL.
 *
 * See `./postgres.ts` for what each column holds. `id` is lowercase hex, so
 * the default case-insensitive collation compares it exactly, and 64
 * characters index well within InnoDB's key limit.
 *
 * @module schemas/spent-challenges/mysql
 */

import { bigint, index, mysqlTable, varchar } from "drizzle-orm/mysql-core";

import { SPENT_CHALLENGES_TABLE } from "./table-name";

// The same table in another dialect's Drizzle builders: each dialect's
// column functions are distinct, so the declarations cannot be shared.
// fallow-ignore-next-line code-duplication
export const nextlySpentChallenges = mysqlTable(
  SPENT_CHALLENGES_TABLE,
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  },
  t => [index("nsc_expires_at_idx").on(t.expiresAt)]
);
