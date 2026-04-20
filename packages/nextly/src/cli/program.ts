/**
 * Nextly CLI Program
 *
 * Main CLI program setup using Commander.js.
 * This file defines the program structure, global options,
 * and command registration.
 *
 * @module cli/program
 * @since 1.0.0
 */

import * as telemetry from "@nextly/telemetry";
import { Command, Option } from "commander";
import pc from "picocolors";

import { registerBuildCommand } from "./commands/build.js";
// What: import the renamed one-shot sync command.
// Why: Task 11 renamed `nextly dev` (utility) to `nextly db:sync` so the
// `nextly dev` name can be reused by the wrapper CLI in Sub-task 3.
import { registerDbSyncCommand } from "./commands/db-sync.js";
// What: import the Task 11 wrapper CLI entry.
// Why: this is the new `nextly dev` - it spawns next dev as a child and
// owns schema-change prompts + restart. Sub-task 3 registers a skeleton;
// Sub-task 4 wires the full prompt/DDL flow.
import { registerDevCommand } from "./commands/dev.js";
import { registerGenerateTypesCommand } from "./commands/generate-types.js";
import { registerInitCommand } from "./commands/init.js";
import { registerMigrateCreateCommand } from "./commands/migrate-create.js";
import { registerMigrateFreshCommand } from "./commands/migrate-fresh.js";
import { registerMigrateResetCommand } from "./commands/migrate-reset.js";
import { registerMigrateStatusCommand } from "./commands/migrate-status.js";
import { registerMigrateCommand } from "./commands/migrate.js";
import { createPermissionsCleanupCommand } from "./commands/permissions-cleanup.js";
import { registerTelemetryCommand } from "./commands/telemetry.js";
import {
  createLogger,
  type Logger,
  type LoggerOptions,
} from "./utils/logger.js";

// ============================================================================
// Version
// ============================================================================

/**
 * CLI version - should match package.json version
 */
export const CLI_VERSION = "0.1.0";

// ============================================================================
// Types
// ============================================================================

/**
 * Global CLI options that apply to all commands
 */
export interface GlobalOptions {
  /**
   * Path to nextly.config.ts file
   */
  config?: string;

  /**
   * Enable verbose output
   */
  verbose?: boolean;

  /**
   * Enable quiet mode (errors only)
   */
  quiet?: boolean;

  /**
   * Working directory
   */
  cwd?: string;

  /**
   * Disable colors
   */
  noColor?: boolean;
}

/**
 * Context passed to command handlers
 */
export interface CommandContext {
  /**
   * Logger instance configured with global options
   */
  logger: Logger;

  /**
   * Global options
   */
  options: GlobalOptions;

  /**
   * Working directory (resolved)
   */
  cwd: string;

  /**
   * Config file path (if specified)
   */
  configPath?: string;
}

// ============================================================================
// Program Creation
// ============================================================================

/**
 * Create the main CLI program with all commands registered
 *
 * @returns Configured Commander program
 */
export function createProgram(): Command {
  const program = new Command()
    .name("nextly")
    .description(
      "Nextly CLI - Manage collections, migrations, and generate types"
    )
    .version(CLI_VERSION, "-V, --version", "Show version number")
    .addOption(new Option("-c, --config <path>", "Path to nextly.config.ts"))
    .addOption(new Option("--verbose", "Enable verbose output").default(false))
    .addOption(new Option("-q, --quiet", "Show errors only").default(false))
    .addOption(
      new Option("--cwd <path>", "Working directory").default(process.cwd())
    )
    .addOption(new Option("--no-color", "Disable colored output"))
    .configureHelp({
      sortSubcommands: true,
      sortOptions: true,
    })
    .showHelpAfterError("(use --help for available options)")
    .addHelpText(
      "after",
      `
${pc.bold("Examples:")}
  ${pc.gray("$")} nextly dev                    ${pc.gray("# Start development mode")}
  ${pc.gray("$")} nextly generate:types         ${pc.gray("# Generate TypeScript types")}
  ${pc.gray("$")} nextly migrate                ${pc.gray("# Run pending migrations")}
  ${pc.gray("$")} nextly migrate:status         ${pc.gray("# Show migration status")}

${pc.bold("Documentation:")}
  ${pc.cyan("https://nextlyhq.com/docs")}
`
    );

  // Register all commands
  registerCommands(program);

  // Telemetry preAction/postAction hooks. We capture command_started before
  // the action runs and command_completed after it returns. The telemetry
  // sub-command itself manages its own init/shutdown so we skip it here.
  let commandStartedAt: number | null = null;
  let currentCommand = "";

  program.hook("preAction", async thisCommand => {
    currentCommand = thisCommand.name();
    if (currentCommand === "telemetry") return; // sub-command handles its own init
    commandStartedAt = Date.now();
    await telemetry.init({ cliName: "nextly", cliVersion: CLI_VERSION });
    const flagsCount = Object.keys(thisCommand.opts()).length;
    telemetry.capture("command_started", {
      command: currentCommand,
      flags_count: flagsCount,
    });
  });

  program.hook("postAction", async thisCommand => {
    if (thisCommand.name() === "telemetry") return;
    if (commandStartedAt === null) return;
    telemetry.capture("command_completed", {
      command: currentCommand,
      duration_ms: Date.now() - commandStartedAt,
    });
    await telemetry.shutdown();
  });

  return program;
}

// ============================================================================
// Command Registration
// ============================================================================

/**
 * Register all CLI commands
 *
 * @param program - Commander program instance
 */
function registerCommands(program: Command): void {
  // Development commands
  registerDevCommand(program);
  registerDbSyncCommand(program);
  registerBuildCommand(program);
  registerInitCommand(program);

  // Type generation commands
  registerGenerateTypesCommand(program);
  registerGenerateSchemaCommand(program);

  // Migration commands
  registerMigrateCommand(program); // Imported from ./commands/migrate.js
  registerMigrateCreateCommand(program);
  registerMigrateStatusCommand(program);
  registerMigrateDownCommand(program);
  registerMigrateFreshCommand(program);
  registerMigrateResetCommand(program);
  registerMigrateRefreshCommand(program);

  // Permissions commands
  program.addCommand(createPermissionsCleanupCommand());

  // Telemetry sub-command (status/enable/disable/reset)
  registerTelemetryCommand(program);
}

// ============================================================================
// Context Helper
// ============================================================================

/**
 * Create a command context from global options
 *
 * @param options - Global options from Commander
 * @returns Command context
 */
export function createContext(options: GlobalOptions): CommandContext {
  const loggerOptions: LoggerOptions = {
    verbose: options.verbose,
    quiet: options.quiet,
    noColor: options.noColor,
  };

  const logger = createLogger(loggerOptions);
  const cwd = options.cwd ?? process.cwd();

  return {
    logger,
    options,
    cwd,
    configPath: options.config,
  };
}

// ============================================================================
// Placeholder Command Implementations
// ============================================================================
// These will be implemented in subsequent subtasks (5.2.1 - 5.2.10)

function notImplemented(commandName: string, context: CommandContext): void {
  context.logger.warn(`Command '${commandName}' is not yet implemented.`);
  context.logger.info("This command will be available in a future release.");
  process.exit(0);
}

// ============================================================================
// Development Commands
// ============================================================================

// registerDbSyncCommand is imported from ./commands/db-sync.js
// registerBuildCommand is imported from ./commands/build.js
// registerInitCommand is imported from ./commands/init.js

// ============================================================================
// Type Generation Commands
// ============================================================================

// registerGenerateTypesCommand is imported from ./commands/generate-types.js

function registerGenerateSchemaCommand(program: Command): void {
  program
    .command("generate:schema")
    .description("Generate Drizzle ORM schema files from collections")
    .option("-o, --output <path>", "Output directory path")
    .action((_cmdOptions: Record<string, unknown>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const context = createContext(globalOpts);
      notImplemented("generate:schema", context);
    });
}

// ============================================================================
// Migration Commands
// ============================================================================

// registerMigrateCommand is imported from ./commands/migrate.js
// registerMigrateCreateCommand is imported from ./commands/migrate-create.js
// registerMigrateStatusCommand is imported from ./commands/migrate-status.js

function registerMigrateDownCommand(program: Command): void {
  program
    .command("migrate:down")
    .alias("migrate:rollback") // Backward compatibility
    .description("Roll back the last batch of migrations")
    .option("--step <n>", "Roll back N migrations", parseInt)
    .action((_cmdOptions: Record<string, unknown>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const context = createContext(globalOpts);
      notImplemented("migrate:down", context);
    });
}

// registerMigrateFreshCommand is imported from ./commands/migrate-fresh.js
// registerMigrateResetCommand is imported from ./commands/migrate-reset.js

function registerMigrateRefreshCommand(program: Command): void {
  program
    .command("migrate:refresh")
    .description("Roll back all migrations and re-run them")
    .option("-f, --force", "Skip confirmation prompt", false)
    .option("--seed", "Run seeders after migrations", false)
    .action((_cmdOptions: Record<string, unknown>, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals() as GlobalOptions;
      const context = createContext(globalOpts);
      notImplemented("migrate:refresh", context);
    });
}
