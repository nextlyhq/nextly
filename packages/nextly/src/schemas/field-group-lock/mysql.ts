/**
 * `nextly_field_group_lock` — MySQL. See `postgres.ts` for what this table is and why it is
 * declared here as well as bootstrapped out-of-band.
 *
 * `int` rather than `integer` mirrors the bootstrap DDL, which picks the same type for this dialect:
 * the declaration and the CREATE have to describe one table, or the reconcile proposes a change to a
 * table that is already correct.
 *
 * @module schemas/field-group-lock/mysql
 */

// Every dialect's file declares its tables under the same names, by design: one is chosen by
// dialect at runtime.
// fallow-ignore-file duplicate-export
import { datetime, int, mysqlTable, text } from "drizzle-orm/mysql-core";

export const nextlyFieldGroupLock = mysqlTable("nextly_field_group_lock", {
  id: int("id").primaryKey(),
  owner: text("owner"),
  expiresAt: datetime("expires_at"),
});

/**
 * `nextly_schema_lock` — the one schema lock, MySQL. See `postgres.ts` for what it is. The times are
 * `DATETIME` written from `UTC_TIMESTAMP()`, as the field-group lock's are, so every session reads
 * them in one zone whatever its own `time_zone`.
 */
export const nextlySchemaLock = mysqlTable("nextly_schema_lock", {
  id: int("id").primaryKey(),
  owner: text("owner"),
  command: text("command"),
  acquiredAt: datetime("acquired_at"),
  expiresAt: datetime("expires_at"),
});
