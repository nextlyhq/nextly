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
  createCliAdapter,
  withAdapter,
  validateDatabaseEnv,
  detectDialectFromUrl,
  getDialectDisplayName,
  dialectSupports,
  type CreateCliAdapterOptions,
  type DatabaseEnvValidation,
  type CLIDatabaseAdapter,
  type SupportedDialect,
} from "./adapter";

// Shared dialect-variant resolution contract for CLI commands
export {
  discoverMigrationGroups,
  // The folder as the runner reads it, synchronously: what `withNextly` loads
  // to name the build's newest migration when an old Builder file is there.
  readMigrationFolderSync,
  selectVariant,
  getSortedBaseNames,
  type MigrationVariant,
  type MigrationGroup,
} from "./migration-discovery";
