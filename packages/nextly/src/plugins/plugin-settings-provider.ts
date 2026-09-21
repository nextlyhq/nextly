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
  db: unknown
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

  // Resolved lazily: the dialect is read from the live database handle, and a
  // context can be built before one is connected.
  const service = () => {
    const dialect = (db as { dialect?: SupportedDialect }).dialect ?? "sqlite";
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
