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

// Every dialect's file declares its tables under the same names, by design: one is chosen by
// dialect at runtime.
// fallow-ignore-file duplicate-export
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const nextlyFieldGroupLock = pgTable("nextly_field_group_lock", {
  id: integer("id").primaryKey(),
  owner: text("owner"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

/**
 * `nextly_schema_lock` — the one schema lock, PostgreSQL.
 *
 * One row. Every path that changes the schema, the migration ledger or the registry holds it for
 * the whole of its work (`domains/schema/pipeline/schema-lock.ts`), and the field-group lock above
 * and `nextly_migrate_lock` are held beside it only so that a process of an earlier Nextly version,
 * which knows only those, is still excluded.
 *
 * `command` and `acquired_at` exist for the refusal a waiting run prints: it names what holds the
 * lock and since when, so an operator can tell a long migration from a stuck one. Declared beside
 * the field-group lock because it is bootstrapped the same way, from these declarations, by the
 * first run that contends for it.
 */
export const nextlySchemaLock = pgTable("nextly_schema_lock", {
  id: integer("id").primaryKey(),
  owner: text("owner"),
  command: text("command"),
  acquiredAt: timestamp("acquired_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});
