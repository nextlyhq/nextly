/**
 * `nextly_dashboard_preferences` on MySQL: what each reader's dashboard
 * remembers for them beyond its layout.
 *
 * One row is one preference of one reader: a key, such as the New type they
 * last chose or whether Get started is collapsed, and a short text value. Kept
 * apart from `nextly_widget_layout` on purpose: a layout row means "this reader
 * arranged the dashboard", so writing a preference there would stop the reader
 * following the default dashboard. The rows go with their reader.
 *
 * @module schemas/dashboard-preferences/mysql
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication
import { mysqlTable, varchar, datetime } from "drizzle-orm/mysql-core";

import {
  DASHBOARD_PREFERENCES_INDEXES,
  mysqlIndexes,
} from "../_internal/core-indexes";
import { users } from "../users/mysql";

import {
  DASHBOARD_PREFERENCE_VALUE_MAX,
  DASHBOARD_PREFERENCES_TABLE,
} from "./table-name";

export const nextlyDashboardPreferencesMysql = mysqlTable(
  DASHBOARD_PREFERENCES_TABLE,
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    // The reader it belongs to: deleted with them by the database. As wide as
    // `users.id`, whose key it holds.
    userId: varchar("user_id", { length: 191 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Not `key`, a reserved word in MySQL, so no statement has to quote it.
    key: varchar("preference_key", { length: 64 }).notNull(),
    value: varchar("value", {
      length: DASHBOARD_PREFERENCE_VALUE_MAX,
    }).notNull(),
    updatedAt: datetime("updated_at", { fsp: 3 })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  // The indexes are declared once, in `core-indexes`, for every dialect.
  table => mysqlIndexes(DASHBOARD_PREFERENCES_INDEXES, table)
);
