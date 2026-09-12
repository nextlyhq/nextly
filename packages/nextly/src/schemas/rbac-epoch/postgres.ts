/**
 * `nextly_rbac_epoch` — how many times RBAC has changed, PostgreSQL.
 *
 * One row, holding a counter that rises whenever a role, a role's permissions
 * or a permission row changes. Every cached authorization answer is filed under
 * the value it was computed at, and an answer filed under an older value is not
 * served.
 *
 * ## Why this is in the database rather than in memory
 *
 * The counter it replaces lived in a module variable, so it only ever moved in
 * the process that handled the change. A second instance neither saw that move
 * nor had one of its own, and went on serving what it had cached until the
 * entry aged out — which for the shared tier meant a revoked grant could
 * outlive its revocation by the whole TTL. A number every instance reads is the
 * only thing that makes "this answer is stale" a fact about the install rather
 * than about one process.
 *
 * ## Why one row with a fixed key
 *
 * `id` is always `global`. Making it the primary key means a second row cannot
 * be inserted, so "there is exactly one counter" is a property of the schema
 * rather than something the code has to keep true. The increment is then a
 * single statement the database evaluates itself — `SET revision = revision + 1`
 * — which is atomic under concurrent writers on every dialect, where a
 * read-modify-write from the application would lose one of two simultaneous
 * invalidations.
 *
 * ## Why a table rather than a column on the cache rows
 *
 * `ensureCoreTables` reconciles an existing database by re-running idempotent
 * `CREATE TABLE IF NOT EXISTS` statements, so a NEW TABLE reaches installs that
 * already exist. It explicitly does not repair a table whose columns drifted,
 * which a new column on `user_permission_cache` would have needed. A separate
 * table is therefore the shape that can actually be delivered to the databases
 * this is meant to protect.
 *
 * @module schemas/rbac-epoch/postgres
 */

import { bigint, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const nextlyRbacEpoch = pgTable("nextly_rbac_epoch", {
  id: text("id").primaryKey(),
  // `bigint` rather than `integer`: this only ever rises, and an install that
  // wrapped a 32-bit counter would start serving answers filed under a value
  // the counter is about to reach again.
  revision: bigint("revision", { mode: "number" }).notNull(),
  // Identity of the counter itself, generated once with the row.
  //
  // A number alone cannot tell "the same counter, unchanged" from "a different
  // counter that happens to read the same" — which is what a restored backup, a
  // re-provisioned environment or a failover that lost writes produces. An
  // instance holding entries filed at 7 would find a fresh counter also at 7
  // and go on serving them. Comparing the pair makes a replaced store retire
  // every cached answer, whatever its number says.
  generation: text("generation").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
