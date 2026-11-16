/**
 * `nextly_plugin_settings` — dialect-aware barrel.
 *
 * @module schemas/plugin-settings
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { loadedDialect } from "../../database/dialect-tables";

export { PLUGIN_SETTINGS_TABLE } from "./table-name";

/** The settings table for the requested dialect, as a schema fragment. */
export function pluginSettingsTables(dialect: SupportedDialect) {
  // The loaded dialect's own tables, so only that dialect's files are
  // imported; `createAdapter` loads them.
  const { nextlyPluginSettings } = loadedDialect(dialect).tables;
  return { nextlyPluginSettings };
}
