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

// Plan C3 — migrate:resolve recovery command
export {
  registerMigrateResolveCommand,
  runMigrateResolve,
} from "./migrate-resolve";

// SP-2 — migrate:down rollback command
export { registerMigrateDownCommand, runMigrateDown } from "./migrate-down";

// F11 PR 2 (Q4=A): migrate:reset removed (forward-only model). Single-step
// rollback is available via `migrate:down` (SP-2); for multi-step recovery
// prefer a new corrective migration or `migrate:fresh`.
// BREAKING: external callers importing `runMigrateReset` or
// `MigrateResetCommandOptions` from this barrel must remove that import.

// Init command
export { registerInitCommand, runInit, type InitCommandOptions } from "./init";

// Add (install sugar) command (D70)
export {
  registerAddCommand,
  runAdd,
  buildInstallArgs,
  detectPackageManager,
  type AddCommandOptions,
  type PackageManager,
} from "./add";

// Upgrade command (Plan B — bookkeeping consolidation)
export {
  registerUpgradeCommand,
  runUpgrade,
  type UpgradeCommandOptions,
  type UpgradeAdapter,
} from "./upgrade";

// Permissions commands
export { createPermissionsCleanupCommand } from "./permissions-cleanup";
