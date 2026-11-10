/**
 * `nextly_schedule_windows` - PostgreSQL.
 *
 * The canonical column list; `./mysql.ts` and `./sqlite.ts` mirror it with
 * their own types. One row per plugin schedule and window: recorded in the
 * transaction that enqueues the window's job, so a window is enqueued once
 * however many runners sweep it and whether or not its job has finished. The
 * primary key is that uniqueness, so an upgraded database cannot lack it.
 *
 * @module schemas/schedule-windows/postgres
 */
import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const nextlyScheduleWindowsPg = pgTable(
  "nextly_schedule_windows",
  {
    // `<plugin name>:<schedule slug>@<definition>`: each cron and time zone
    // a schedule is declared with keeps windows of its own.
    scheduleKey: text("schedule_key").notNull(),
    // When the window opens: the time its schedule fired, to the minute.
    windowAt: timestamp("window_at", { withTimezone: true }).notNull(),
    // The job enqueued for the window; null for the window a schedule was
    // first seen in, which is recorded without a job so a schedule deployed
    // after its window opened waits for the next one.
    jobId: text("job_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
    primaryKey({ columns: [table.scheduleKey, table.windowAt] }),
    // Pruning a removed schedule reads the oldest windows of every key.
    index("nextly_schedule_windows_window_idx").on(table.windowAt),
  ]
);
