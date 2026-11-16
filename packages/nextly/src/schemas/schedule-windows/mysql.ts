/**
 * `nextly_schedule_windows` - MySQL. Mirrors `./postgres.ts`.
 *
 * @module schemas/schedule-windows/mysql
 */
import {
  datetime,
  index,
  mysqlTable,
  primaryKey,
  varbinary,
  varchar,
} from "drizzle-orm/mysql-core";

export const nextlyScheduleWindowsMysql = mysqlTable(
  "nextly_schedule_windows",
  {
    // Bytes, so keys compare exactly whatever the table's collation: a case-
    // or accent-insensitive one would make two schedules one. 191 bytes is
    // the portable key cap.
    scheduleKey: varbinary("schedule_key", { length: 191 }).notNull(),
    windowAt: datetime("window_at", { fsp: 3 }).notNull(),
    jobId: varchar("job_id", { length: 36 }),
    createdAt: datetime("created_at", { fsp: 3 })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
    primaryKey({ columns: [table.scheduleKey, table.windowAt] }),
    index("nextly_schedule_windows_window_idx").on(table.windowAt),
  ]
);
