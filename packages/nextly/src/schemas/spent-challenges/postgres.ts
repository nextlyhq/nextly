/**
 * `nextly_spent_challenges` — two-factor challenges already answered, PostgreSQL.
 *
 * One row per interrupted sign-in whose challenge was answered correctly.
 * `id` is a keyed hash of the flow, in hex, rather than the flow: a fixed
 * width every dialect indexes, compared byte for byte whatever collation the
 * database uses, and holding no account id. It is the primary key, so of two
 * answers that both try to write it, on any instance, only one can: that one
 * write is what makes the challenge single-use. `expires_at` is when the
 * pending token it guards stops being accepted, in milliseconds since the
 * epoch; past it the row guards nothing and is removed.
 *
 * @module schemas/spent-challenges/postgres
 */

import { bigint, index, pgTable, varchar } from "drizzle-orm/pg-core";

import { SPENT_CHALLENGES_TABLE } from "./table-name";

// The same table in another dialect's Drizzle builders: each dialect's
// column functions are distinct, so the declarations cannot be shared.
// fallow-ignore-next-line code-duplication
export const nextlySpentChallenges = pgTable(
  SPENT_CHALLENGES_TABLE,
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  },
  // The sweep finds expired marks by this.
  t => [index("nsc_expires_at_idx").on(t.expiresAt)]
);
