/**
 * `nextly_plugin_settings` — configuration a plugin stores, MySQL.
 *
 * See `./postgres.ts` for the shape and why the value is text.
 *
 * @module schemas/plugin-settings/mysql
 */

import {
  boolean,
  mediumtext,
  mysqlTable,
  primaryKey,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

import { PLUGIN_SETTINGS_TABLE } from "./table-name";
import {
  PLUGIN_SETTING_KEY_LENGTH,
  PLUGIN_SETTING_OWNER_LENGTH,
} from "./widths";

export const nextlyPluginSettings = mysqlTable(
  PLUGIN_SETTINGS_TABLE,
  {
    // Bounded, because MySQL cannot key a TEXT column without a prefix length.
    owner: varchar("owner", { length: PLUGIN_SETTING_OWNER_LENGTH }).notNull(),
    key: varchar("key", { length: PLUGIN_SETTING_KEY_LENGTH }).notNull(),
    // `mediumtext` (16 MiB), not `TEXT` (65,535 bytes): an encrypted value is
    // about twice its plaintext, so a large setting saved on PostgreSQL and
    // SQLite failed or was truncated here. The service bounds every value
    // below this, so all three dialects refuse the same input.
    value: mediumtext("value").notNull(),
    isSecret: boolean("is_secret").notNull().default(false),
    updatedAt: timestamp("updated_at").notNull(),
    updatedBy: varchar("updated_by", { length: 191 }),
  },
  table => [primaryKey({ columns: [table.owner, table.key] })]
);
