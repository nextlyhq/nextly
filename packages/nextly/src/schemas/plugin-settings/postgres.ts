/**
 * `nextly_plugin_settings` — configuration a plugin stores, PostgreSQL.
 *
 * One row per plugin per top-level settings key. Keyed by `(owner, key)` so a
 * plugin cannot be given two values for the same setting, and so one plugin's
 * settings can never be read or written under another's name.
 *
 * ## Why the value is text rather than JSON
 *
 * A secret is encrypted BEFORE it is written, which produces a string. Storing
 * the column as JSON would mean a secret value has a different shape from a
 * plain one, and every read would need to know which it was looking at before
 * it could parse it. Text with `is_secret` beside it keeps one shape and one
 * decision.
 *
 * @module schemas/plugin-settings/postgres
 */

import {
  boolean,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { PLUGIN_SETTINGS_TABLE } from "./table-name";

export const nextlyPluginSettings = pgTable(
  PLUGIN_SETTINGS_TABLE,
  {
    /** The plugin's name, as declared in its manifest. */
    owner: text("owner").notNull(),
    /** A top-level key of the plugin's declared settings schema. */
    key: text("key").notNull(),
    /** JSON, or ciphertext when the whole value is a secret. */
    value: text("value").notNull(),
    /** Whether `value` is ciphertext rather than readable JSON. */
    isSecret: boolean("is_secret").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull(),
    /** Who wrote it, when a person did. Null for a write the system made. */
    updatedBy: text("updated_by"),
  },
  table => [primaryKey({ columns: [table.owner, table.key] })]
);
