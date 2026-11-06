/**
 * `nextly_field_group_lock` — SQLite. See `postgres.ts` for what this table is and why it is
 * declared here as well as bootstrapped out-of-band.
 *
 * @module schemas/field-group-lock/sqlite
 */

// Every dialect's file declares its tables under the same names, by design: one is chosen by
// dialect at runtime.
// fallow-ignore-file duplicate-export
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const nextlyFieldGroupLock = sqliteTable("nextly_field_group_lock", {
  id: integer("id").primaryKey(),
  owner: text("owner"),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
});

/**
 * `nextly_schema_lock` — the one schema lock, SQLite. See `postgres.ts` for what it is. The times
 * are unix seconds, as the field-group lock's are. The row excludes a second process on the same
 * file because every claim is read and written inside one `BEGIN IMMEDIATE` transaction, which
 * SQLite runs one at a time across connections.
 */
export const nextlySchemaLock = sqliteTable("nextly_schema_lock", {
  id: integer("id").primaryKey(),
  owner: text("owner"),
  command: text("command"),
  acquiredAt: integer("acquired_at", { mode: "timestamp" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
});
