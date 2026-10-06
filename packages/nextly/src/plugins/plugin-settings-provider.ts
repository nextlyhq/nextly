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

import { announcePluginSettingsChange } from "../domains/plugins/settings-activity";
import {
  PluginSettingsService,
  pluginSettingsSecrets,
} from "../domains/plugins/settings-service";
import { createPluginSettingsStore } from "../domains/plugins/settings-store";
import { NextlyError } from "../errors/nextly-error";
import { env } from "../lib/env";
import {
  afterCommit,
  type AfterCommitAdapter,
} from "../shared/lib/run-adapter-transaction";

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
  dialect: SupportedDialect,
  /**
   * The database adapter. Its transaction runner carries the write on SQLite,
   * where Drizzle's own transaction cannot carry awaited work, and the change
   * is announced through its `afterCommit`. Lazily supplied so the context can
   * be built before the database is connected, exactly like the store; absent,
   * the write uses Drizzle's transaction and is announced at once.
   */
  adapter?: () => SettingsAdapter
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
      store: createPluginSettingsStore(
        db,
        dialect,
        // SQLite cannot use Drizzle's transaction (better-sqlite3 refuses an
        // async callback), so writes ride the adapter's manual BEGIN IMMEDIATE
        // runner; the store's handle shares the connection it opens.
        dialect === "sqlite" ? sqliteTransaction(adapter) : undefined
      ),
      secrets: () => pluginSettingsSecrets(env),
    });
  };

  return {
    get: () => service().get(),
    // A plugin's own write is announced like an operator's, so another plugin
    // in this process caching these values hears that they moved. The event
    // bus is in-process: other instances do not receive it. It has no request
    // actor, so it records no audit entry.
    // Inside a plugin's `ctx.db.transaction` on SQLite the write is a
    // savepoint of it, so the change is announced once that commits, and never
    // when it rolls back.
    set: async (patch, opts) => {
      const changedKeys = await service().set(patch, opts);
      const announce = () =>
        announcePluginSettingsChange({ plugin: plugin.name, changedKeys });
      await (adapter ? afterCommit(adapter(), announce) : announce());
    },
  };
}

/** The adapter surface a plugin's settings write needs. */
export interface SettingsAdapter extends AfterCommitAdapter {
  transaction<T>(work: () => Promise<T>): Promise<T>;
}

/**
 * The adapter's transaction runner, bound to it: an extracted `transaction`
 * would lose its receiver, and the SQLite adapter reads instance state before
 * it opens the transaction.
 */
function sqliteTransaction(
  adapter: (() => SettingsAdapter) | undefined
): (<T>(work: () => Promise<T>) => Promise<T>) | undefined {
  if (!adapter) return undefined;
  const resolved = adapter();
  return work => resolved.transaction(work);
}
