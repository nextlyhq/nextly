/**
 * Legacy tables held here pending removal by Plan B (`nextly upgrade`) — SQLite.
 *
 * See postgres.ts for the deprecation rationale.
 *
 * @deprecated Plan A transitional. Removed by Plan B's first task.
 * @module schemas/_legacy/sqlite
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import {
  sqliteTable,
  integer,
  text,
  index,
} from "drizzle-orm/sqlite-core";

/** @deprecated Removed in Plan B. */
export const systemMigrations = sqliteTable("system_migrations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  runAt: integer("run_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * Audit table for dynamic DDL events.
 *
 * @deprecated Removed in Plan B; superseded by `nextly_schema_events`.
 */
export const contentSchemaEvents = sqliteTable(
  "content_schema_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    op: text("op").notNull(),
    tableName: text("table_name").notNull(),
    sqlText: text("sql").notNull(),
    meta: text("meta"), // JSON stored as text in SQLite
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  t => [
    index("content_schema_events_created_at_idx").on(t.createdAt),
    index("content_schema_events_table_name_idx").on(t.tableName),
  ]
);
