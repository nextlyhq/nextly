/**
 * `nextly_workflow_settings` - PostgreSQL.
 *
 * The canonical column list; `./mysql.ts` and `./sqlite.ts` mirror it with their own types. One row
 * per workflow, holding what admins change for it on this environment: each stage's default
 * reviewer, label and colour overrides, and which notifications also send an email. The stages
 * and steps themselves are the code's, and are never stored here.
 *
 * @module schemas/workflow-settings/postgres
 */
// The same table in each dialect's Drizzle builders: each dialect's column
// functions are distinct, so the declarations cannot be shared, and the
// parity test is what holds them in step.
// fallow-ignore-file code-duplication

import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const nextlyWorkflowSettingsPg = pgTable(
  "nextly_workflow_settings",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // The workflow's name in the configuration.
    workflow: text("workflow").notNull(),
    // The settings as JSON text, parsed at the repository's boundary.
    settings: text("settings").notNull(),
    // Raised by one on every write, so an edit made over one it didn't see is refused.
    revision: integer("revision").notNull(),
    // The person who last changed them.
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .$defaultFn(() => new Date())
      .notNull(),
  },
  table => [
    uniqueIndex("nextly_workflow_settings_workflow_uidx").on(table.workflow),
  ]
);
