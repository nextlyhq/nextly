/**
 * CLI Utilities
 *
 * Utility functions for the Nextly CLI.
 *
 * @module cli/utils
 * @since 1.0.0
 */

export {
  loadConfig,
  watchConfig,
  clearConfigCache,
  getCachedConfig,
  findNextlyConfig,
  type LoadConfigOptions,
  type LoadConfigResult,
  type ConfigChangeCallback,
  SUPPORTED_EXTENSIONS,
  SEARCH_DIRECTORIES,
} from "./config-loader";

export {
  createLogger,
  logger,
  formatDuration,
  formatBytes,
  formatCount,
  type LogLevel,
  type LoggerOptions,
  type Logger,
} from "./logger";

export {
  createAdapter,
  withAdapter,
  validateDatabaseEnv,
  detectDialectFromUrl,
  getDialectDisplayName,
  dialectSupports,
  type CreateAdapterOptions,
  type DatabaseEnvValidation,
  type CLIDatabaseAdapter,
  type SupportedDialect,
} from "./adapter";
