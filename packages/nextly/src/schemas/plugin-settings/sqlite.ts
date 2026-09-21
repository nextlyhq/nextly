/**
 * `nextly_plugin_settings` — configuration a plugin stores, SQLite.
 *
 * See `./postgres.ts` for the shape and why the value is text.
 *
 * @module schemas/plugin-settings/sqlite
 */

import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { PLUGIN_SETTINGS_TABLE } from "./table-name";

export const nextlyPluginSettings = sqliteTable(
  PLUGIN_SETTINGS_TABLE,
  {
    owner: text("owner").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    isSecret: integer("is_secret", { mode: "boolean" })
      .notNull()
      .default(false),
    // Unix seconds, as every other timestamp in this dialect's tables.
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    updatedBy: text("updated_by"),
  },
  table => [primaryKey({ columns: [table.owner, table.key] })]
);
