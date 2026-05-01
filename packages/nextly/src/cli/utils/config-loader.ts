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
 * import { loadConfig, watchConfig } from '@revnixhq/nextly/cli/utils/config-loader';
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

import { bundleRequire } from "bundle-require";

import {
  defineConfig,
  type SanitizedNextlyConfig,
} from "../../collections/config/define-config";
import { NextlyError } from "../../errors/index";

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

  fileWatcher = watch(configPath, async eventType => {
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
    const { mod, dependencies } = await bundleRequire({
      filepath: configPath,
      format: "esm",
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

    const plugins = config.plugins ?? [];
    if (plugins.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let transformedConfig: any = { ...config };

      for (const plugin of plugins) {
        if (plugin.config) {
          try {
            transformedConfig = plugin.config(transformedConfig);
          } catch (error) {
            throw new NextlyError({
              code: "INVALID_INPUT",
              publicMessage: "Failed to load Nextly configuration.",
              statusCode: 400,
              logMessage: "Config loader error",
              logContext: {
                configPath,
                reason: "plugin-config-transformer-failed",
                pluginName: plugin.name,
                cause:
                  error instanceof Error ? error.message : String(error),
              },
              cause: error instanceof Error ? error : undefined,
            });
          }
        }
      }

      config = {
        ...config,
        collections: transformedConfig.collections ?? config.collections,
        singles: transformedConfig.singles ?? config.singles,
        plugins: transformedConfig.plugins ?? config.plugins,
        storage: transformedConfig.storage ?? config.storage,
      };

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
        cause: error instanceof Error ? error.message : String(error),
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
