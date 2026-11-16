/**
 * `nextly_workflow_settings` - SQLite. Mirrors `./postgres.ts`, which documents each column.
 *
 * @module schemas/workflow-settings/sqlite
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication

import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const nextlyWorkflowSettingsSqlite = sqliteTable(
  "nextly_workflow_settings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workflow: text("workflow").notNull(),
    settings: text("settings").notNull(),
    revision: integer("revision").notNull(),
    updatedBy: text("updated_by"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
    uniqueIndex("nextly_workflow_settings_workflow_uidx").on(table.workflow),
  ]
);
