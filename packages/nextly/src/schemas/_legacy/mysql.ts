/**
 * Legacy tables held here pending removal by Plan B (`nextly upgrade`) — MySQL.
 *
 * See postgres.ts for the deprecation rationale.
 *
 * @deprecated Plan A transitional. Removed by Plan B's first task.
 * @module schemas/_legacy/mysql
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import {
  mysqlTable,
  int,
  varchar,
  datetime,
  json,
  index,
} from "drizzle-orm/mysql-core";

/** @deprecated Removed in Plan B. */
export const systemMigrations = mysqlTable("system_migrations", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  runAt: datetime("run_at").notNull().default(new Date()),
});

/**
 * Audit table for dynamic DDL events.
 *
 * @deprecated Removed in Plan B; superseded by `nextly_schema_events`.
 */
export const contentSchemaEvents = mysqlTable(
  "content_schema_events",
  {
    id: int("id").autoincrement().primaryKey(),
    op: varchar("op", { length: 191 }).notNull(),
    tableName: varchar("table_name", { length: 255 }).notNull(),
    sqlText: varchar("sql", { length: 1024 }).notNull(),
    meta: json("meta"),
    createdAt: datetime("created_at").notNull().default(new Date()),
  },
  t => [
    index("content_schema_events_created_at_idx").on(t.createdAt),
    index("content_schema_events_table_name_idx").on(t.tableName),
  ]
);
