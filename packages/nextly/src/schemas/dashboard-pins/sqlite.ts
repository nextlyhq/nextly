/**
 * `nextly_dashboard_pins` on SQLite: the entries and Singles each reader
 * pinned to their dashboard.
 *
 * One row is one pin, of a collection entry or a Single, by one reader. A
 * Single has no entry, so its `entry_id` is "" rather than NULL: the unique
 * index over (reader, target) then holds on every dialect, with no partial
 * index. Losing access to a target keeps the pin; the reader sees it again if
 * access returns. The pin goes with its reader, and with its target when that
 * is deleted.
 *
 * @module schemas/dashboard-pins/sqlite
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import {
  DASHBOARD_PINS_INDEXES,
  sqliteIndexes,
} from "../_internal/core-indexes";
import { users } from "../users/sqlite";

import { DASHBOARD_PINS_TABLE } from "./table-name";

export const nextlyDashboardPinsSqlite = sqliteTable(
  DASHBOARD_PINS_TABLE,
  {
    id: text("id").primaryKey().notNull(),
    // The reader who pinned it: deleted with them by the database.
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // "collection" or "single".
    targetType: text("target_type").notNull(),
    targetSlug: text("target_slug").notNull(),
    // The pinned entry's id; "" for a Single.
    entryId: text("entry_id").notNull(),
    pinnedAt: integer("pinned_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => sqliteIndexes(DASHBOARD_PINS_INDEXES, table)
);
