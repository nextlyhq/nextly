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
  text,
  varchar,
} from "drizzle-orm/mysql-core";

export const nextlyScheduleWindowsMysql = mysqlTable(
  "nextly_schedule_windows",
  {
    // 191 characters: the portable key cap, so the key fits an index.
    scheduleKey: varchar("schedule_key", { length: 191 }).notNull(),
    windowAt: datetime("window_at", { fsp: 3 }).notNull(),
    jobId: varchar("job_id", { length: 36 }),
    definition: text("definition").notNull(),
    createdAt: datetime("created_at", { fsp: 3 })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
    primaryKey({ columns: [table.scheduleKey, table.windowAt] }),
    index("nextly_schedule_windows_window_idx").on(table.windowAt),
  ]
);
