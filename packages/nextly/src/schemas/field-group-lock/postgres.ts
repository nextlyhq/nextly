/**
 * `nextly_field_group_lock` — the field-group storage migration's mutual-exclusion row, PostgreSQL.
 *
 * One row, one nullable owner. A schema change and a storage migration contend for it, so exactly
 * one of them runs at a time; `owner` is NULL when the lock is free and carries a per-invocation
 * claim string when it is held.
 *
 * ## Why this is declared here as well as bootstrapped
 *
 * The session creates this table out-of-band with `getMigrationLockDdl`, because it has to exist
 * before anything can contend for it and the code that needs it runs long before a migration would.
 * Declaring it here is what makes it RECONCILABLE: `getCoreSchema` is what `nextly migrate` pushes,
 * and a table outside that set can never receive a column, an index, or any other change — the
 * bootstrap DDL is `CREATE TABLE IF NOT EXISTS`, which does nothing at all to a table that already
 * exists. That is the same reasoning `nextly_schema_events` and `nextly_i18n_archive` are declared
 * on, and this table is the one system table that was missing it.
 *
 * @module schemas/field-group-lock/postgres
 */

import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const nextlyFieldGroupLock = pgTable("nextly_field_group_lock", {
  id: integer("id").primaryKey(),
  owner: text("owner"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});
