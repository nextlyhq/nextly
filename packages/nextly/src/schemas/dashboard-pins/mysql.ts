/**
 * `nextly_dashboard_pins` on MySQL: the entries and Singles each reader
 * pinned to their dashboard.
 *
 * One row is one pin, of a collection entry or a Single, by one reader. A
 * Single has no entry, so its `entry_id` is "" rather than NULL: the unique
 * index over (reader, target) then holds on every dialect, with no partial
 * index. Losing access to a target keeps the pin; the reader sees it again if
 * access returns. The pin goes with its reader, and with its target when that
 * is deleted.
 *
 * @module schemas/dashboard-pins/mysql
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import { mysqlTable, varchar, datetime } from "drizzle-orm/mysql-core";

import {
  DASHBOARD_PINS_INDEXES,
  mysqlIndexes,
} from "../_internal/core-indexes";
import { users } from "../users/mysql";

import { DASHBOARD_PINS_TABLE } from "./table-name";

export const nextlyDashboardPinsMysql = mysqlTable(
  DASHBOARD_PINS_TABLE,
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    // The reader who pinned it: deleted with them by the database. As wide as
    // `users.id`, whose key it holds.
    userId: varchar("user_id", { length: 191 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // "collection" or "single".
    targetType: varchar("target_type", { length: 16 }).notNull(),
    targetSlug: varchar("target_slug", { length: 191 }).notNull(),
    // The pinned entry's id; "" for a Single. The unique index over these four
    // columns stays inside MySQL's 3072-byte key limit: (191 + 16 + 191 + 191)
    // characters at four bytes each.
    entryId: varchar("entry_id", { length: 191 }).notNull(),
    pinnedAt: datetime("pinned_at", { fsp: 3 })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => mysqlIndexes(DASHBOARD_PINS_INDEXES, table)
);
