/**
 * CLI Commands
 *
 * Exports all CLI command implementations.
 *
 * @module cli/commands
 * @since 1.0.0
 */

// Development commands
// (with `nextly sync` as alias). The `nextly dev` name is reserved for
export {
  registerDbSyncCommand,
  runDbSync,
  type DbSyncCommandOptions,
} from "./db-sync";

// Build commands
export {
  registerBuildCommand,
  runBuild,
  type BuildCommandOptions,
} from "./build";

// Type generation commands
export {
  registerGenerateTypesCommand,
  runGenerateTypes,
  type GenerateTypesCommandOptions,
} from "./generate-types";

// Migration commands
export {
  registerMigrateCommand,
  runMigrate,
  type MigrateCommandOptions,
} from "./migrate";

export {
  registerMigrateCreateCommand,
  runMigrateCreate,
  type MigrateCreateCommandOptions,
} from "./migrate-create";

export {
  registerMigrateStatusCommand,
  runMigrateStatus,
  type MigrateStatusCommandOptions,
} from "./migrate-status";

export {
  registerMigrateFreshCommand,
  runMigrateFresh,
  type MigrateFreshCommandOptions,
} from "./migrate-fresh";

// F11 PR 2 (Q4=A): migrate:reset removed (forward-only model). Operators
// who relied on rollback should write a new corrective migration instead.
// BREAKING: external callers importing `runMigrateReset` or
// `MigrateResetCommandOptions` from this barrel must remove that import.

// Init command
export {
  registerInitCommand,
  runInit,
  type InitCommandOptions,
} from "./init";

// Upgrade command (Plan B — bookkeeping consolidation)
export {
  registerUpgradeCommand,
  runUpgrade,
  type UpgradeCommandOptions,
  type UpgradeAdapter,
} from "./upgrade";

// Permissions commands
export { createPermissionsCleanupCommand } from "./permissions-cleanup";
