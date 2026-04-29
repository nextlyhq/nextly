/**
 * CLI Commands
 *
 * Exports all CLI command implementations.
 *
 * @module cli/commands
 * @since 1.0.0
 */

// Development commands
// Task 11 rename: former `nextly dev` command moved to `nextly db:sync`
// (with `nextly sync` as alias). The `nextly dev` name is reserved for
// the wrapper CLI that Sub-task 3 introduces.
export {
  registerDbSyncCommand,
  runDbSync,
  type DbSyncCommandOptions,
} from "./db-sync.js";

// Build commands
export {
  registerBuildCommand,
  runBuild,
  type BuildCommandOptions,
} from "./build.js";

// Type generation commands
export {
  registerGenerateTypesCommand,
  runGenerateTypes,
  type GenerateTypesCommandOptions,
} from "./generate-types.js";

// Migration commands
export {
  registerMigrateCommand,
  runMigrate,
  type MigrateCommandOptions,
} from "./migrate.js";

export {
  registerMigrateCreateCommand,
  runMigrateCreate,
  type MigrateCreateCommandOptions,
} from "./migrate-create.js";

export {
  registerMigrateStatusCommand,
  runMigrateStatus,
  type MigrateStatusCommandOptions,
} from "./migrate-status.js";

export {
  registerMigrateFreshCommand,
  runMigrateFresh,
  type MigrateFreshCommandOptions,
} from "./migrate-fresh.js";

// F11 PR 2 (Q4=A): migrate:reset removed (forward-only model). Operators
// who relied on rollback should write a new corrective migration instead.
// BREAKING: external callers importing `runMigrateReset` or
// `MigrateResetCommandOptions` from this barrel must remove that import.

// Init command
export {
  registerInitCommand,
  runInit,
  type InitCommandOptions,
} from "./init.js";

// Permissions commands
export { createPermissionsCleanupCommand } from "./permissions-cleanup.js";
