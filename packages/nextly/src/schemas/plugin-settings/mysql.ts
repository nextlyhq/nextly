/**
 * `nextly_plugin_settings` — configuration a plugin stores, MySQL.
 *
 * See `./postgres.ts` for the shape and why the value is text.
 *
 * @module schemas/plugin-settings/mysql
 */

import {
  boolean,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

import { PLUGIN_SETTINGS_TABLE } from "./table-name";

export const nextlyPluginSettings = mysqlTable(
  PLUGIN_SETTINGS_TABLE,
  {
    // Bounded, because MySQL cannot key a TEXT column without a prefix length.
    owner: varchar("owner", { length: 191 }).notNull(),
    key: varchar("key", { length: 191 }).notNull(),
    value: text("value").notNull(),
    isSecret: boolean("is_secret").notNull().default(false),
    updatedAt: timestamp("updated_at").notNull(),
    updatedBy: varchar("updated_by", { length: 191 }),
  },
  table => [primaryKey({ columns: [table.owner, table.key] })]
);
