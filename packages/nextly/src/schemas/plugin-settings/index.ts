/**
 * `nextly_plugin_settings` — dialect-aware barrel.
 *
 * @module schemas/plugin-settings
 */

import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../errors/nextly-error";

import * as my from "./mysql";
import * as pg from "./postgres";
import * as sl from "./sqlite";

export { pg, my, sl };
export { PLUGIN_SETTINGS_TABLE } from "./table-name";

/**
 * The ONE place a dialect is turned into a settings table.
 *
 * The `never` assignment makes the compiler demand a case for a dialect added
 * later; a ternary chain ending in a bare `else` would hand back another
 * dialect's table and compile.
 */
function settingsForDialect(dialect: SupportedDialect) {
  switch (dialect) {
    case "postgresql":
      return pg.nextlyPluginSettings;
    case "mysql":
      return my.nextlyPluginSettings;
    case "sqlite":
      return sl.nextlyPluginSettings;
    default: {
      const _exhaustive: never = dialect;
      throw NextlyError.internal({
        logContext: {
          reason: "no plugin settings table for this dialect",
          dialect: String(_exhaustive),
        },
      });
    }
  }
}

/** The settings table for the requested dialect, as a schema fragment. */
export function pluginSettingsTables(dialect: SupportedDialect) {
  return { nextlyPluginSettings: settingsForDialect(dialect) };
}
