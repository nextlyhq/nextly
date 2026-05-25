/**
 * Legacy tables held here pending removal by Plan B (`nextly upgrade`).
 *
 * - systemMigrations: superseded by the new pipeline; will be dropped along
 *   with the legacy `unified-schema.ts` ledger in Plan B.
 * - contentSchemaEvents: superseded by `nextly_schema_events`; rows are
 *   archived by Plan B's first migration before the table is dropped.
 *
 * DO NOT add new imports of these — they will be deleted in Plan B PR.
 *
 * @deprecated Plan A transitional. Removed by Plan B's first task.
 * @module schemas/_legacy/postgres
 * @since v0.0.3-alpha (Plan A — schemas consolidation)
 */

import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/** @deprecated Removed in Plan B. */
export const systemMigrations = pgTable("system_migrations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  runAt: timestamp("run_at", { withTimezone: false }).defaultNow().notNull(),
});

/**
 * Audit table for dynamic DDL events.
 *
 * @deprecated Removed in Plan B; superseded by `nextly_schema_events`.
 */
export const contentSchemaEvents = pgTable(
  "content_schema_events",
  {
    id: serial("id").primaryKey(),
    op: text("op").notNull(),
    tableName: text("table_name").notNull(),
    sqlText: text("sql").notNull(),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: false })
      .defaultNow()
      .notNull(),
  },
  t => [
    index("content_schema_events_created_at_idx").on(t.createdAt),
    index("content_schema_events_table_name_idx").on(t.tableName),
  ]
);
