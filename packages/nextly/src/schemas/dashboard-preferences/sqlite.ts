/**
 * `nextly_dashboard_preferences` on SQLite: what each reader's dashboard
 * remembers for them beyond its layout.
 *
 * One row is one preference of one reader: a key, such as the New type they
 * last chose or whether Get started is collapsed, and a short text value. Kept
 * apart from `nextly_widget_layout` on purpose: a layout row means "this reader
 * arranged the dashboard", so writing a preference there would stop the reader
 * following the default dashboard. The rows go with their reader.
 *
 * @module schemas/dashboard-preferences/sqlite
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import {
  DASHBOARD_PREFERENCES_INDEXES,
  sqliteIndexes,
} from "../_internal/core-indexes";
import { users } from "../users/sqlite";

import { DASHBOARD_PREFERENCES_TABLE } from "./table-name";

export const nextlyDashboardPreferencesSqlite = sqliteTable(
  DASHBOARD_PREFERENCES_TABLE,
  {
    id: text("id").primaryKey().notNull(),
    // The reader it belongs to: deleted with them by the database.
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Not `key`, a reserved word in MySQL, so no statement has to quote it.
    key: text("preference_key").notNull(),
    // SQLite keeps no length; the repository holds a value to the limit.
    value: text("value").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => sqliteIndexes(DASHBOARD_PREFERENCES_INDEXES, table)
);
