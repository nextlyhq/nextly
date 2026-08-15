/**
 * `nextly_field_group_lock` — SQLite. See `postgres.ts` for what this table is and why it is
 * declared here as well as bootstrapped out-of-band.
 *
 * @module schemas/field-group-lock/sqlite
 */

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const nextlyFieldGroupLock = sqliteTable("nextly_field_group_lock", {
  id: integer("id").primaryKey(),
  owner: text("owner"),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
});
