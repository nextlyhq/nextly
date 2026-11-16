/**
 * `nextly_workflow_settings` - MySQL. Mirrors `./postgres.ts`, which documents each column.
 *
 * @module schemas/workflow-settings/mysql
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication

import {
  datetime,
  int,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const nextlyWorkflowSettingsMysql = mysqlTable(
  "nextly_workflow_settings",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workflow: varchar("workflow", { length: 64 }).notNull(),
    settings: text("settings").notNull(),
    revision: int("revision").notNull(),
    updatedBy: varchar("updated_by", { length: 255 }),
    createdAt: datetime("created_at", { fsp: 3 })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: datetime("updated_at", { fsp: 3 })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
    uniqueIndex("nextly_workflow_settings_workflow_uidx").on(table.workflow),
  ]
);
