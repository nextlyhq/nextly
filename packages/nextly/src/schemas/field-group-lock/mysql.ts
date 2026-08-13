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

import { int, mysqlTable, text } from "drizzle-orm/mysql-core";

export const nextlyFieldGroupLock = mysqlTable("nextly_field_group_lock", {
  id: int("id").primaryKey(),
  owner: text("owner"),
});
