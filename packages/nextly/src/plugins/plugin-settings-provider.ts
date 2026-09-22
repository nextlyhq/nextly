/**
 * Building one plugin's `ctx.settings`.
 *
 * Kept out of `plugin-context` so that module does not import the settings
 * domain, the schema barrel and the encryption helpers just to hand a plugin
 * an object it may never use.
 *
 * @module plugins/plugin-settings-provider
 * @since 1.0.0
 */
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";

import {
  PluginSettingsService,
  pluginSettingsSecrets,
} from "../domains/plugins/settings-service";
import { createPluginSettingsStore } from "../domains/plugins/settings-store";
import { NextlyError } from "../errors/nextly-error";
import { env } from "../lib/env";

import type { PluginDefinition, PluginSettingsApi } from "./plugin-context";

/**
 * The settings API for one plugin.
 *
 * Its secret paths come from the plugin's own manifest, which resolution has
 * already checked against the declared schema — so a path here is one the
 * schema really has, rather than a typo that would store a credential in plain
 * text without a word.
 */
export function createPluginSettings(
  plugin: PluginDefinition,
  db: unknown,
  dialect: SupportedDialect
): PluginSettingsApi {
  const schema = plugin.contributes?.settings;
  if (!schema) {
    throw NextlyError.internal({
      logContext: {
        reason: "plugin settings requested for a plugin that declares none",
        plugin: plugin.name,
      },
    });
  }

  // The dialect is PASSED, not read off the handle. What a plugin receives is
  // a restricted wrapper exposing four query methods and nothing else, so
  // `db.dialect` was always undefined and every install fell back to SQLite:
  // MySQL has no `onConflictDoUpdate` and failed the write outright, and
  // Postgres was handed SQLite's column encoders, which store a timestamp as
  // an integer. The store itself stays lazy, because a context can be built
  // before the database is connected.
  const service = () => {
    return new PluginSettingsService({
      owner: plugin.name,
      schema,
      secretPaths: plugin.capabilities?.secrets ?? [],
      store: createPluginSettingsStore(db, dialect),
      secrets: () => pluginSettingsSecrets(env),
    });
  };

  return {
    get: () => service().get(),
    set: (patch, opts) => service().set(patch, opts),
  };
}
