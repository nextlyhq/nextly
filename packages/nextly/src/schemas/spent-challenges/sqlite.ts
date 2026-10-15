/**
 * `nextly_spent_challenges` — two-factor challenges already answered, SQLite.
 *
 * See `./postgres.ts` for what each column holds. `expires_at` is an integer
 * of milliseconds, not `mode: "timestamp"` seconds, as on the other dialects.
 *
 * @module schemas/spent-challenges/sqlite
 */

import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { SPENT_CHALLENGES_TABLE } from "./table-name";

export const nextlySpentChallenges = sqliteTable(
  SPENT_CHALLENGES_TABLE,
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at").notNull(),
  },
  t => [index("nsc_expires_at_idx").on(t.expiresAt)]
);
