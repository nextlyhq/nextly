/**
 * `nextly_schedule_windows` - SQLite. Mirrors `./postgres.ts`.
 *
 * @module schemas/schedule-windows/sqlite
 */
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const nextlyScheduleWindowsSqlite = sqliteTable(
  "nextly_schedule_windows",
  {
    scheduleKey: text("schedule_key").notNull(),
    windowAt: integer("window_at", { mode: "timestamp" }).notNull(),
    jobId: text("job_id"),
    definition: text("definition").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [primaryKey({ columns: [table.scheduleKey, table.windowAt] })]
);
