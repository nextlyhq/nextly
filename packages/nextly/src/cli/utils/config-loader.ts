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
import {
  clearFieldTypes,
  registerFieldType,
} from "../../domains/schema/field-types/field-type-registry";
import { loadUiSchema } from "../../domains/schema/ui-schema/loader";
import { manifestToBuilderEntities } from "../../domains/schema/ui-schema/merge";
import { NextlyError, describeError } from "../../errors/index";
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
    components: folded.components ?? base.components,
    plugins: transformed.plugins ?? base.plugins,
    storage: transformed.storage ?? base.storage,
  };
}

/**
 * Merge a plugin-`setup()`-transformed config back onto the base config and fold
 * declarative plugin schema contributions (D3/D12) via the SAME shared function
 * the runtime boot uses (`applyPluginSchemaContributionsDeferred` in
 * `register.ts`), so the CLI and runtime produce the same merged schema (D50).
 * Threads collections, singles, AND components. Extend targets that aren't
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
    void (async () => {
      if (eventType === "change") {
        debugLog(options, "Config file changed, reloading...");

        cachedConfig = null;

        try {
          const result = await loadConfigInternal(options);

          for (const callback of changeCallbacks) {
            try {
              callback(result);
            } catch (error) {
              console.error("[config-loader] Error in change callback:", error);
            }
          }
        } catch (error) {
          console.error("[config-loader] Error reloading config:", error);
        }
      }
    })();
  });

  fileWatcher.on("error", error => {
    console.error("[config-loader] File watcher error:", error);
  });
}

function stopWatching(): void {
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }
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
    return {
      config: defineConfig({}),
      configPath: undefined,
      dependencies: [],
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
      clearFieldTypes();
      for (const fieldTypePlugin of plugins) {
        for (const fieldType of fieldTypePlugin.contributes?.fieldTypes ?? []) {
          registerFieldType(fieldType);
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
      collectCustomPermissions(
        config as unknown as NextlyServiceConfig,
        plugins
      );

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
    };
  } catch (error) {
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

  const result = await loadConfigInternal(options);

  cachedConfig = result;

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
