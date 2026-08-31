/**
 * Config Loader
 *
 * Loads and parses nextly.config.ts at runtime using esbuild.
 * Supports TypeScript, ESM, and CommonJS config files.
 *
 * @module cli/utils/config-loader
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { loadConfig, watchConfig } from 'nextly/cli/utils/config-loader';
 *
 * // Load config once
 * const config = await loadConfig();
 *
 * // Watch for changes (dev mode)
 * const config = await loadConfig({ watch: true });
 * watchConfig((newConfig) => {
 *   console.log('Config updated:', newConfig);
 * });
 * ```
 */

import { existsSync, watch, type FSWatcher } from "node:fs";
import { resolve, dirname } from "node:path";

import {
  defineConfig,
  type SanitizedNextlyConfig,
} from "../../collections/config/define-config";
import type { NextlyServiceConfig } from "../../di/register";
import { emailRetentionAfterTransform } from "../../domains/email/retention-config";
import {
  clearFieldTypes,
  registerFieldType,
  restoreFieldTypes,
  snapshotFieldTypes,
  withoutDisabledBehavior,
} from "../../domains/schema/field-types/field-type-registry";
import { loadUiSchema } from "../../domains/schema/ui-schema/loader";
import { manifestToBuilderEntities } from "../../domains/schema/ui-schema/merge";
import { NextlyError, describeError } from "../../errors/index";
import type { PluginFieldType } from "../../plugins/contributions";
import { getCoreVersion } from "../../plugins/core-version";
import { collectCustomPermissions } from "../../plugins/permissions/collect-permissions";
import type { PluginDefinition } from "../../plugins/plugin-context";
import { resolvePlugins } from "../../plugins/resolve";
import {
  applyPluginSchemaContributionsDeferred,
  type BuilderEntities,
  type DeferredExtend,
  resolveBuilderExtends,
} from "../../plugins/schema/apply-contributions";
import {
  collectUnresolvedRelationTargets,
  finalizeRelationTargets,
  validateCrossPluginRelations,
} from "../../plugins/schema/validate-relations";
import { assertAdminWidgets } from "../../plugins/validate-admin-widgets";
import { validatePluginSlugs } from "../../plugins/validate-slugs";

import { bundleAndRequire } from "./config-bundler";

/** Builder collection slugs (the only valid relationTo targets among Builder entities). */
function builderCollectionSlugs(builder: BuilderEntities): string[] {
  return (builder.collections ?? []).map(c => c.slug);
}

/**
 * Validate (D6) and topologically order (D5) the configured plugins using the
 * single shared resolver — the SAME resolver the runtime uses (register.ts), so
 * CLI and runtime agree on order and fail identically (D6). Fail-fast (D7).
 * The CLI then runs each plugin's `setup` in this order.
 */
export function orderConfigPlugins(
  plugins: PluginDefinition[]
): PluginDefinition[] {
  if (plugins.length === 0) return plugins;
  return resolvePlugins(plugins, { coreVersion: getCoreVersion() });
}

/** Merge the folded collections/singles/components + transformed plugins/storage onto base. Pure. */
function applyFoldedToBase(
  base: SanitizedNextlyConfig,
  folded: NextlyServiceConfig,
  transformed: SanitizedNextlyConfig
): SanitizedNextlyConfig {
  return {
    ...base,
    collections: folded.collections ?? base.collections,
    singles: folded.singles ?? base.singles,
    fieldGroups: folded.fieldGroups ?? base.fieldGroups,
    plugins: transformed.plugins ?? base.plugins,
    storage: transformed.storage ?? base.storage,
    // Carry a plugin setup transformer's audit decision through, so an audit
    // plugin that forces recording is not dropped back to the base value on a
    // reload. Always a resolved boolean on a sanitized config.
    webhookAuditEnabled: transformed.webhookAuditEnabled,
    // Likewise carry a plugin's resolved retention policy: a plugin that tunes
    // or disables `webhooks.retention` in setup() must not be reverted to the
    // base value (which `webhooks:prune` and the runtime would otherwise use).
    webhookRetention: transformed.webhookRetention,
    // And the email block, which is the one this list was missing. A plugin
    // that sets `email.retention: false` in setup() had that decision reverted
    // on the first reload, because only the base value was carried here — so an
    // unrelated save could start deleting rows the live boot configuration had
    // been retaining.
    //
    // The flattened policy is DERIVED from the block rather than carried
    // beside it, through the same function the DI root uses. Carrying both
    // independently is what let them disagree in the first place.
    email: transformed.email ?? base.email,
    emailRetention:
      emailRetentionAfterTransform(transformed.email, base.emailRetention) ??
      base.emailRetention,
  };
}

/**
 * Merge a plugin-`setup()`-transformed config back onto the base config and fold
 * declarative plugin schema contributions (D3/D12) via the SAME shared function
 * the runtime boot uses (`applyPluginSchemaContributionsDeferred` in
 * `register.ts`), so the CLI and runtime produce the same merged schema (D50).
 * Threads collections, singles, AND field groups. Extend targets that aren't
 * code/plugin entities are deferred (candidate Builder targets, P8/R2) and
 * resolved by the caller against the Builder set — not thrown here. Exported for
 * unit/parity testing.
 */
export function mergeSetupResultIntoConfig(
  base: SanitizedNextlyConfig,
  transformed: SanitizedNextlyConfig,
  plugins: PluginDefinition[]
): SanitizedNextlyConfig {
  const { config: folded } = applyPluginSchemaContributionsDeferred(
    transformed as unknown as NextlyServiceConfig,
    plugins
  );
  return applyFoldedToBase(base, folded, transformed);
}

/**
 * Options for loading the config file.
 */
export interface LoadConfigOptions {
  /**
   * Custom path to the config file.
   * If not provided, searches default locations.
   */
  configPath?: string;

  /**
   * Working directory for resolving relative paths.
   * Defaults to `process.cwd()`.
   */
  cwd?: string;

  /**
   * Enable watch mode for file changes.
   * When enabled, the config will be reloaded on changes.
   * @default false
   */
  watch?: boolean;

  /**
   * Enable verbose logging for debugging.
   * @default false
   */
  debug?: boolean;
}

/**
 * Result of loading the config file.
 */
export interface LoadConfigResult {
  /**
   * The loaded and sanitized config.
   */
  config: SanitizedNextlyConfig;

  /**
   * Path to the config file that was loaded.
   * Undefined if using default config (no file found).
   */
  configPath?: string;

  /**
   * List of files that the config depends on.
   * Useful for watch mode to know what files to watch.
   */
  dependencies: string[];

  /**
   * Plugin `contributes.extend` clauses whose target wasn't a code/plugin entity
   * (candidate Builder/UI-schema targets, P8). Already resolved + validated here
   * against the Builder set; threaded out so `migrate-create`/`migrate-check` can
   * materialize the extra columns onto the Builder tables without re-folding.
   */
  deferredExtends?: DeferredExtend[];

  /**
   * The plugin field types this config registered, captured at the end of its
   * load.
   *
   * Work that outlives the load it started from — the `db:sync` watcher keeps
   * syncing across a save — resolves against this rather than the live registry,
   * which the next load clears and rebuilds.
   */
  fieldTypes?: ReadonlyMap<string, PluginFieldType>;
}

/**
 * Callback for config change events.
 */
export type ConfigChangeCallback = (result: LoadConfigResult) => void;

const CONFIG_FILE_NAMES = [
  "nextly.config.ts",
  "nextly.config.mts",
  "nextly.config.js",
  "nextly.config.mjs",
];

const CONFIG_SEARCH_DIRS = [".", "./src", "./config"];

let cachedConfig: LoadConfigResult | null = null;

let fileWatcher: FSWatcher | null = null;

/** The reload currently running for the watched file, if any. */
let watcherReload: Promise<void> | null = null;

/** Whether a save arrived while that reload was running. */
let watcherReloadPending = false;

/**
 * The options the next drained reload should use.
 *
 * The loop below used to close over the options it started with. A watcher
 * stopped mid-reload and immediately replaced — `clearConfigCache()` followed
 * by another `watch: true` load — left that loop reloading the OLD config and
 * delivering it to the NEW callbacks, while the new watcher's change was never
 * loaded at all. Reading the latest options each turn means a drained reload
 * always belongs to the watcher that is currently installed.
 */
let watcherReloadOptions: LoadConfigOptions | null = null;

/**
 * Which watcher the reloads in flight belong to.
 *
 * Stopping a watcher bumps this. A reload already awaiting its load carries the
 * value it started with, so it can tell that the watcher it was triggered for
 * has since been replaced and decline to deliver a config nobody asked for to
 * callbacks registered by whoever replaced it.
 */
let watcherGeneration = 0;

/**
 * The field-type registry the currently installed config loaded.
 *
 * A superseded reload finishing last leaves its own registrations live. This is
 * what it has to put back — the set belonging to whoever is watching now, not
 * whatever the registry happened to hold before that reload started.
 */
let installedFieldTypes: ReadonlyMap<string, PluginFieldType> | null = null;

/**
 * The tail of the loads that rebuild the process-wide field-type registry.
 *
 * A load clears the registry, registers the config's own types, and only then
 * awaits again before snapshotting what it registered. Two loads overlapping
 * across that await share one registry, so each can capture the other's types —
 * and a superseded watcher reload, whose job is to put the installed set back,
 * can put it back over a live load's registrations, leaving the new config
 * paired with the previous config's types.
 *
 * The watcher's own reloads were already serialized against each other. An
 * explicit `loadConfig()` never joined them, so a `clearConfigCache()` and
 * reload arriving while a reload was in flight overlapped with it.
 */
let registryLoad: Promise<void> = Promise.resolve();

/**
 * Run `load` once every earlier registry-rebuilding load has finished.
 *
 * The chain records completion rather than outcome: a rejection left on it
 * would be adopted by every later waiter and fail loads that were fine.
 */
function withRegistryLock<T>(load: () => Promise<T>): Promise<T> {
  const run = registryLoad.then(load);
  registryLoad = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

const changeCallbacks: Set<ConfigChangeCallback> = new Set();

function findConfigFile(cwd: string): string | undefined {
  for (const dir of CONFIG_SEARCH_DIRS) {
    for (const fileName of CONFIG_FILE_NAMES) {
      const filePath = resolve(cwd, dir, fileName);
      if (existsSync(filePath)) {
        return filePath;
      }
    }
  }
  return undefined;
}

function debugLog(options: LoadConfigOptions, ...args: unknown[]): void {
  if (options.debug) {
    console.log("[config-loader]", ...args);
  }
}

function startWatching(configPath: string, options: LoadConfigOptions): void {
  stopWatching();

  debugLog(options, "Starting file watcher for:", configPath);

  fileWatcher = watch(configPath, eventType => {
    if (eventType !== "change") return;
    debugLog(options, "Config file changed, reloading...");
    scheduleWatchReload(options);
  });

  fileWatcher.on("error", error => {
    console.error("[config-loader] File watcher error:", error);
  });
}

/** One reload of the watched file, notifying every registered callback. */
async function runWatchReload(options: LoadConfigOptions): Promise<void> {
  const generation = watcherGeneration;
  cachedConfig = null;

  // The lock covers the load and the registry bookkeeping that follows it, so
  // the decision about which set is installed is made against a registry no
  // other load is rebuilding. It is released before the callbacks run: those
  // are caller code, and one of them calling `loadConfig()` while this held the
  // lock would wait on itself.
  const result = await withRegistryLock(async () => {
    try {
      const loaded = await loadConfigInternal(options);

      // The watcher this reload belongs to was stopped while the load was in
      // flight, so this result describes a config nothing is watching.
      // Delivering it would hand the replacement watcher's callbacks the
      // previous config, which they would apply until the replacement's own
      // reload arrived.
      if (generation !== watcherGeneration) {
        // The load cleared and rebuilt the live registry on its way through, so
        // the set left behind is this obsolete config's. Put back whatever the
        // watcher that is actually installed loaded, or every later lookup
        // would classify its fields with the wrong storage primitives.
        if (installedFieldTypes) restoreFieldTypes(installedFieldTypes);
        return null;
      }

      // This reload is the live one, so its registry is the authoritative set.
      installedFieldTypes = loaded.fieldTypes ?? snapshotFieldTypes();
      return loaded;
    } catch (error) {
      // A failed load restores the registry it found, which for a superseded
      // reload is the obsolete config's rather than the installed one's. Put
      // the installed set back for the same reason the success path does.
      if (generation !== watcherGeneration && installedFieldTypes) {
        restoreFieldTypes(installedFieldTypes);
      }
      console.error("[config-loader] Error reloading config:", error);
      return null;
    }
  });

  if (!result) return;

  for (const callback of changeCallbacks) {
    try {
      callback(result);
    } catch (error) {
      console.error("[config-loader] Error in change callback:", error);
    }
  }
}

/**
 * Serialize reloads triggered by the watcher.
 *
 * A load clears and rebuilds the process-wide field-type registry and captures
 * what it registered on its result. Two overlapping loads share that registry,
 * so each could capture the other's types and hand a caller a config paired
 * with the wrong ones — which is exactly what the result's snapshot exists to
 * prevent.
 *
 * Saves arriving during a reload collapse into one trailing run rather than
 * queueing per event: they all want the state after the last of them, and the
 * file is read fresh when that run starts.
 */
function scheduleWatchReload(options: LoadConfigOptions): void {
  watcherReloadOptions = options;

  if (watcherReload) {
    watcherReloadPending = true;
    return;
  }

  watcherReload = (async () => {
    do {
      watcherReloadPending = false;
      const next = watcherReloadOptions;
      // Cleared by `stopWatching`, which is how a reload queued against a
      // watcher that no longer exists is dropped rather than applied.
      if (!next) break;
      await runWatchReload(next);
    } while (watcherReloadPending);
  })().finally(() => {
    watcherReload = null;
    // A save that arrived while this loop was leaving set the flag against a
    // run that had already stopped checking it, so it starts the next one.
    if (watcherReloadPending && watcherReloadOptions) {
      scheduleWatchReload(watcherReloadOptions);
    }
  });
}

/** Record the registry a freshly installed config left live. */
function markInstalledFieldTypes(result: LoadConfigResult): void {
  installedFieldTypes = result.fieldTypes ?? snapshotFieldTypes();
}

function stopWatching(): void {
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }
  // Anything this watcher had queued belongs to a config nobody is watching
  // for any more, and applying it would hand the next watcher's callbacks a
  // result they never asked for.
  watcherReloadPending = false;
  watcherReloadOptions = null;
  watcherGeneration += 1;
}

async function loadConfigInternal(
  options: LoadConfigOptions
): Promise<LoadConfigResult> {
  const cwd = options.cwd ?? process.cwd();

  const configPath = options.configPath
    ? resolve(cwd, options.configPath)
    : findConfigFile(cwd);

  if (!configPath) {
    debugLog(options, "No config file found, using default config");
    // Cleared here too: a long-lived process that had loaded a plugin config
    // and then lost its config file would otherwise keep the removed plugins'
    // types registered, and Builder saves would go on recognizing them and
    // running their `validate` and `validateOptions`.
    clearFieldTypes();
    return {
      config: defineConfig({}),
      configPath: undefined,
      dependencies: [],
      // Empty, matching the clear above: work pinned to this result must not
      // resolve plugin types a later config happens to register.
      fieldTypes: snapshotFieldTypes(),
    };
  }

  if (!existsSync(configPath)) {
    throw new NextlyError({
      code: "INVALID_INPUT",
      publicMessage: "Failed to load Nextly configuration.",
      statusCode: 400,
      logMessage: "Config loader error",
      logContext: { configPath, reason: "config-not-found" },
    });
  }

  debugLog(options, "Loading config from:", configPath);

  // Held across the whole load so a failure below can put the registry back.
  // Callers that keep running on the previous config after a bad edit — the
  // `db:sync` watcher, the HMR reload — would otherwise resolve that config's
  // plugin field types against an empty registry.
  const previousFieldTypes = snapshotFieldTypes();

  try {
    // bundleAndRequire is our Turbopack-safe alternative to the
    // previous `bundle-require` dependency. See `config-bundler.ts`
    // for the full rationale; the short version is bundle-require's
    // internal `import(file)` triggers Turbopack's "Cannot find
    // module as expression is too dynamic" failure when nextly
    // runs inside a Next.js dev server. The new loader uses
    // `createRequire(import.meta.url)` instead, which Turbopack
    // recognizes as a Node-builtin escape hatch and does not
    // analyze. The external-list contract is preserved verbatim.
    const { mod, dependencies } = await bundleAndRequire({
      filepath: configPath,
      cwd: dirname(configPath),
      external: [
        "nextly",
        "@nextly/*",
        "drizzle-orm",
        "drizzle-orm/*",
        "better-sqlite3",
        "pg",
        "mysql2",
        "next",
        "next/*",
        "react",
        "react-dom",
        "dotenv",
        "crypto",
        "fs",
        "path",
        "node:*",
      ],
    });

    const rawConfig = mod.default ?? mod;

    if (!rawConfig || typeof rawConfig !== "object") {
      throw new NextlyError({
        code: "INVALID_INPUT",
        publicMessage: "Failed to load Nextly configuration.",
        statusCode: 400,
        logMessage: "Config loader error",
        logContext: {
          configPath,
          reason: "invalid-config-export",
          exportType: typeof rawConfig,
        },
      });
    }

    let config = defineConfig(rawConfig);
    let deferredExtends: DeferredExtend[] | undefined;

    // Resolve (validate + topo order) before running setups, mirroring the
    // runtime boot (register.ts) so both paths agree (D5/D6/D7).
    const plugins = orderConfigPlugins(config.plugins ?? []);

    // Cleared on EVERY load, not only when plugins are present. A reload that
    // removes the last plugin would otherwise leave its types in the
    // process-global registry, so its `validateOptions` would keep running and
    // later Builder saves would keep treating the type as registered.
    clearFieldTypes();

    if (plugins.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let transformedConfig: any = { ...config, plugins };

      for (const plugin of plugins) {
        if (plugin.setup) {
          try {
            transformedConfig = plugin.setup(transformedConfig);
          } catch (error) {
            throw new NextlyError({
              code: "INVALID_INPUT",
              publicMessage: "Failed to load Nextly configuration.",
              statusCode: 400,
              logMessage: "Config loader error",
              logContext: {
                configPath,
                reason: "plugin-setup-transformer-failed",
                pluginName: plugin.name,
                cause: describeError(error),
              },
              cause: error instanceof Error ? error : undefined,
            });
          }
        }
      }

      // The transformed list, for the same reason the runtime validates its
      // own: a `setup` transformer can add or rename plugins into a slug
      // collision, and everything below consumes the transformed config. The
      // CLI has to agree with boot here — otherwise `nextly build`, a
      // migration or a db sync accepts and acts on a configuration the
      // deployed app then refuses to start on.
      validatePluginSlugs(transformedConfig.plugins ?? []);

      // The widgets on that same transformed list, and here for the same
      // reason the runtime checks its own: a transformer can contribute a
      // widget the resolver's list never held, and a value `JSON.stringify`
      // cannot carry breaks the whole `/api/admin-meta/workspace` response
      // rather than the one card. The CLI has to agree with boot, or
      // `nextly build` accepts a configuration the deployed app refuses to
      // start on.
      assertAdminWidgets(transformedConfig.plugins ?? []);

      // Fold plugin contributions. Extend targets that aren't code/plugin
      // entities are DEFERRED (candidate Builder/UI-schema targets) rather than
      // thrown, so a plugin may extend/relate to a Builder-made collection
      // (P8/D3/R2).
      const folded = applyPluginSchemaContributionsDeferred(
        transformedConfig,
        plugins
      );
      config = applyFoldedToBase(config, folded.config, transformedConfig);
      deferredExtends = folded.deferredExtends;

      // Register plugin custom field types (C7/D16) so the CLI's column
      // classifier (getColumnDescriptor) resolves each plugin type to its
      // storage primitive when reading ui-schema.json — parity with runtime boot
      // (di/register.ts). Clear-and-rebuild; ALL plugins (incl. disabled, per
      // D49) since field types are declarative + schema-affecting.
      for (const fieldTypePlugin of plugins) {
        for (const fieldType of fieldTypePlugin.contributes?.fieldTypes ?? []) {
          registerFieldType(
            withoutDisabledBehavior(fieldType, fieldTypePlugin)
          );
        }
      }

      // Load the Builder set (ui-schema) and resolve the deferred extend +
      // relation targets against it — the SAME shared functions the runtime boot
      // runs (D50). Eager fail-fast is preserved: a target in NEITHER code/plugin
      // NOR the Builder set still throws. ui-schema is optional (empty manifest
      // when absent), so non-Builder apps behave exactly as before.
      let builderEntities: BuilderEntities = {};
      try {
        const manifest = await loadUiSchema({
          projectRoot: cwd,
          uiSchemaFile: config.db?.uiSchemaFile,
        });
        builderEntities = manifestToBuilderEntities(manifest);
      } catch {
        // A malformed ui-schema is surfaced by migrate-create/-check (which
        // re-load it); loading config for other commands shouldn't hard-fail here.
      }
      resolveBuilderExtends(folded.deferredExtends, builderEntities);
      finalizeRelationTargets(
        collectUnresolvedRelationTargets(
          config as unknown as NextlyServiceConfig
        ),
        builderCollectionSlugs(builderEntities)
      );
      validateCrossPluginRelations(plugins);

      // Fail fast on invalid plugin-declared custom permissions (D36) — same
      // collector the runtime boot runs (register.ts), so both paths agree (D50).
      collectCustomPermissions(config, plugins);

      debugLog(
        options,
        `Applied config transformers from ${plugins.length} plugin(s)`
      );
    }

    debugLog(options, "Config loaded successfully");
    debugLog(options, "Dependencies:", dependencies);

    return {
      config,
      configPath,
      dependencies,
      deferredExtends,
      // Captured after registration, so it holds exactly what this config
      // contributed rather than whatever the live set becomes later.
      fieldTypes: snapshotFieldTypes(),
    };
  } catch (error) {
    // The load owns the registry from the clear above until it returns, so
    // every failure between them leaves it half-built or empty.
    restoreFieldTypes(previousFieldTypes);

    if (NextlyError.is(error)) {
      throw error;
    }

    throw new NextlyError({
      code: "INVALID_INPUT",
      publicMessage: "Failed to load Nextly configuration.",
      statusCode: 400,
      logMessage: "Config loader error",
      logContext: {
        configPath,
        reason: "load-error",
        cause: describeError(error),
      },
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Load the Nextly configuration from file.
 *
 * Searches for config files in the following locations (in order):
 * 1. `./nextly.config.ts`
 * 2. `./nextly.config.mts`
 * 3. `./nextly.config.js`
 * 4. `./nextly.config.mjs`
 * 5. `./src/nextly.config.ts` (and other extensions)
 * 6. `./config/nextly.config.ts` (and other extensions)
 *
 * If no config file is found, returns a default configuration.
 *
 * @param options - Load options
 * @returns Promise resolving to the loaded config result
 *
 * @example
 * ```typescript
 * // Basic usage
 * const { config } = await loadConfig();
 * console.log(config.collections);
 *
 * // With custom path
 * const { config } = await loadConfig({
 *   configPath: './custom/nextly.config.ts'
 * });
 *
 * // With watch mode
 * const { config } = await loadConfig({ watch: true });
 * watchConfig((result) => {
 *   console.log('Config changed:', result.config);
 * });
 * ```
 */
export async function loadConfig(
  options: LoadConfigOptions = {}
): Promise<LoadConfigResult> {
  if (cachedConfig && !options.watch) {
    debugLog(options, "Returning cached config");
    return cachedConfig;
  }

  // Serialized with the watcher's reloads, which rebuild the same registry. A
  // reload still in flight from a watcher this call is replacing would
  // otherwise interleave with it and put its own set back over this one's.
  const result = await withRegistryLock(async () => {
    const loaded = await loadConfigInternal(options);

    cachedConfig = loaded;
    // This config is now the installed one, so its registry is what a
    // superseded reload has to put back if it finishes after the swap.
    markInstalledFieldTypes(loaded);
    return loaded;
  });

  if (options.watch && result.configPath) {
    startWatching(result.configPath, options);
  }

  return result;
}

/**
 * Register a callback to be called when the config file changes.
 * Only works when config was loaded with `watch: true`.
 *
 * @param callback - Function to call when config changes
 * @returns Unsubscribe function
 *
 * @example
 * ```typescript
 * // Load with watch mode
 * await loadConfig({ watch: true });
 *
 * // Register callback
 * const unsubscribe = watchConfig((result) => {
 *   console.log('Config updated:', result.config);
 * });
 *
 * // Later, unsubscribe
 * unsubscribe();
 * ```
 */
export function watchConfig(callback: ConfigChangeCallback): () => void {
  changeCallbacks.add(callback);

  return () => {
    changeCallbacks.delete(callback);
  };
}

/**
 * Clear the cached config and stop watching.
 * Useful for testing or when you need to force a reload.
 *
 * @example
 * ```typescript
 * // Clear cache and reload
 * clearConfigCache();
 * const { config } = await loadConfig();
 * ```
 */
export function clearConfigCache(): void {
  cachedConfig = null;
  stopWatching();
  changeCallbacks.clear();
}

/**
 * Get the currently cached config without loading.
 * Returns null if no config is cached.
 *
 * @returns Cached config result or null
 *
 * @example
 * ```typescript
 * const cached = getCachedConfig();
 * if (cached) {
 *   console.log('Using cached config');
 * } else {
 *   const { config } = await loadConfig();
 * }
 * ```
 */
export function getCachedConfig(): LoadConfigResult | null {
  return cachedConfig;
}

/**
 * Check if a config file exists in the default locations.
 *
 * @param cwd - Working directory to search from
 * @returns Path to config file if found, undefined otherwise
 *
 * @example
 * ```typescript
 * const configPath = findNextlyConfig();
 * if (configPath) {
 *   console.log('Found config at:', configPath);
 * } else {
 *   console.log('No config file found');
 * }
 * ```
 */
export function findNextlyConfig(
  cwd: string = process.cwd()
): string | undefined {
  return findConfigFile(cwd);
}

/**
 * Supported config file extensions.
 */
export const SUPPORTED_EXTENSIONS = CONFIG_FILE_NAMES;

/**
 * Default search directories for config files.
 */
export const SEARCH_DIRECTORIES = CONFIG_SEARCH_DIRS;
