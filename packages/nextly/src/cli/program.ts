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

import { Command, Option } from "commander";
import pc from "picocolors";

import {
  setCancelEndsRun,
  setNonInteractive,
} from "../domains/schema/migrate/can-prompt";
import { getCoreVersion } from "../plugins/core-version";

import { registerAddCommand } from "./commands/add.command";
import { registerBuildCommand } from "./commands/build.command";
import { registerClearPlaintextPasswordsCommand } from "./commands/clear-plaintext-passwords.command";
import { registerCreateAdminCommand } from "./commands/create-admin.command";
// What: import the renamed one-shot sync command.
import { registerDbSyncCommand } from "./commands/db-sync.command";
import { registerGenerateManifestCommand } from "./commands/generate-manifest.command";
import { registerGenerateTypesCommand } from "./commands/generate-types.command";
import { registerGenerateWidgetCommand } from "./commands/generate-widget.command";
import { registerI18nRestoreCommand } from "./commands/i18n-restore.command";
import { registerInitCommand } from "./commands/init.command";
import { createMediaCommand } from "./commands/media.command";
import { registerMigrateBaselineCommand } from "./commands/migrate-baseline.command";
import { registerMigrateCheckCommand } from "./commands/migrate-check.command";
import { registerMigrateCreateCommand } from "./commands/migrate-create.command";
import { registerMigrateDownCommand } from "./commands/migrate-down.command";
import { registerMigrateFieldGroupsCommand } from "./commands/migrate-field-groups.command";
import { registerMigrateFreshCommand } from "./commands/migrate-fresh.command";
import { registerMigrateResolveCommand } from "./commands/migrate-resolve.command";
// F11 PR 2 (Q4=A): migrate:reset deleted. SP-2 adds single-step rollback via
// migrate:down (runs the file's -- DOWN section); multi-step recovery still
// prefers a new corrective migration or migrate:fresh.
import { registerMigrateStatusCommand } from "./commands/migrate-status.command";
import { registerMigrateCommand } from "./commands/migrate.command";
import { createPermissionsCleanupCommand } from "./commands/permissions-cleanup.command";
import { registerPluginsCommand } from "./commands/plugins.command";
import { registerPruneCommand } from "./commands/prune.command";
import { registerRepairColumnsCommand } from "./commands/repair-columns.command";
import { registerSetupTokenCommand } from "./commands/setup-token.command";
import { registerTelemetryCommand } from "./commands/telemetry.command";
import { registerUpgradeCommand } from "./commands/upgrade.command";
import { registerWebhooksPruneCommand } from "./commands/webhooks-prune.command";
import { createContext, type CommandContext } from "./context";
import { CLI_MODES, setModeLineWriter } from "./environment";
import { addExitCodesHelp } from "./exit-codes";

export {
  createContext,
  type CommandContext,
  type GlobalOptions,
} from "./context";

// ============================================================================
// Version
// ============================================================================

/**
 * The running `nextly` version, as `--version` and telemetry report it.
 *
 * Asked of {@link getCoreVersion} rather than typed here. "Should match
 * package.json" was a comment with nothing enforcing it, and it did not: the
 * constant read `0.1.0` while the package shipped `0.0.2-alpha.65`, so
 * `nextly --version` answered confidently and wrongly, and telemetry attributed
 * every CLI event to a version that has never been published.
 *
 * `getCoreVersion` is the same question the plugin resolver asks to validate a
 * plugin's `nextly` range, and it already reads the build-time constant the
 * tsdown and vitest `define` blocks inject from `package.json`, with a runtime
 * read as a fallback.
 */
export const CLI_VERSION = getCoreVersion();

// ============================================================================
// Types
// ============================================================================

// ============================================================================
// Program Creation
// ============================================================================

/** What the entry point adds to the program it runs. */
export interface ProgramOptions {
  /**
   * Runs before any command's action, and only then: the entry point reads the
   * project's environment files here, so an answer-only invocation (`--help`,
   * `--version`, an unknown command) reads none.
   */
  beforeAction?: (program: Command) => void | Promise<void>;
}

/**
 * Whether `command` is `nextly telemetry` or one of its subcommands. A hook
 * installed on the program is handed the program itself as its first
 * argument, so the command that runs is the second, `actionCommand`.
 */
function isTelemetryCommand(command: Command): boolean {
  for (let at: Command | null = command; at !== null; at = at.parent) {
    if (at.name() === "telemetry") return true;
  }
  return false;
}

/**
 * Create the main CLI program with all commands registered. Every command is
 * declared without loading its work, so building the program is cheap.
 *
 * @returns Configured Commander program
 */
export function createProgram(options: ProgramOptions = {}): Command {
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
    // Read before Commander runs, by the entry point's environment step; declared
    // here so every command accepts it and a value outside the three is refused.
    .addOption(
      new Option(
        "--mode <mode>",
        "Mode to run in, which picks the environment files (default: from NODE_ENV)"
      ).choices(CLI_MODES)
    )
    // Every prompt asks `canPrompt`, which this turns off: a command that
    // needs an answer then stops and names the flag that gives it.
    .addOption(
      new Option(
        "--non-interactive",
        "Never prompt; a command that needs an answer stops and names the flag"
      ).default(false)
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
  ${pc.gray("$")} next dev                      ${pc.gray("# Start the dev server (Nextly boots in-process)")}
  ${pc.gray("$")} nextly generate:types         ${pc.gray("# Generate TypeScript types")}
  ${pc.gray("$")} nextly generate:manifest --check ${pc.gray("# Fail if the committed block manifest is stale")}
  ${pc.gray("$")} nextly generate:widget open-orders ${pc.gray("# Scaffold a dashboard widget and its test")}
  ${pc.gray("$")} nextly migrate                ${pc.gray("# Run pending migrations")}
  ${pc.gray("$")} nextly migrate:status         ${pc.gray("# Show migration status")}

${pc.bold("Documentation:")}
  ${pc.cyan("https://nextlyhq.com/docs")}
`
    );

  // Register all commands
  registerCommands(program);
  // Then end the program's help and every command's with what its exit
  // status means: last, so the block follows any help text added before it.
  addExitCodesHelp(program);

  // Telemetry preAction/postAction hooks. We capture command_started before
  // the action runs and command_completed after it returns. The telemetry
  // sub-command itself manages its own init/shutdown so we skip it here.
  let commandStartedAt: number | null = null;
  let currentCommand = "";

  program.hook("preAction", async (thisCommand, actionCommand) => {
    // First, before anything a command loads: only an action reaches this
    // hook, so `--help`, `--version` and an unknown command never run it.
    await options.beforeAction?.(thisCommand);
    // The run's `--non-interactive`, for every prompt the command may reach.
    setNonInteractive(
      thisCommand.opts<{ nonInteractive?: boolean }>().nonInteractive === true
    );
    // A cancel at any prompt a command reaches ends the run with exit 130.
    setCancelEndsRun(true);
    // The mode line goes to stderr, so a command's `--json` output stays one
    // document, and `--quiet` keeps it to errors only.
    setModeLineWriter(
      thisCommand.opts<{ quiet?: boolean }>().quiet
        ? undefined
        : line => process.stderr.write(`${line}\n`)
    );
    currentCommand = thisCommand.name();
    // A telemetry command handles its own init, and its dry run must open no
    // consent store at all.
    if (isTelemetryCommand(actionCommand)) return;
    commandStartedAt = Date.now();
    // Loaded here, with the command, so declaring the program loads none of it.
    const telemetry = await import("@nextlyhq/telemetry");
    await telemetry.init({ cliName: "nextly", cliVersion: CLI_VERSION });
    const flagsCount = Object.keys(thisCommand.opts()).length;
    telemetry.capture("command_started", {
      command: currentCommand,
      flags_count: flagsCount,
    });
  });

  program.hook("postAction", async (_thisCommand, actionCommand) => {
    if (isTelemetryCommand(actionCommand)) return;
    if (commandStartedAt === null) return;
    const telemetry = await import("@nextlyhq/telemetry");
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
  // Development commands.
  // F1 PR 4: `nextly dev` removed entirely. The single supported dev
  // command is now `next dev` directly (the schema apply pipeline runs
  // in-process via the HMR listener shipped in F1 PR 2).
  registerDbSyncCommand(program);
  registerBuildCommand(program);
  registerInitCommand(program);
  registerAddCommand(program);

  // Type generation commands
  registerGenerateTypesCommand(program);
  registerGenerateWidgetCommand(program); // scaffold a dashboard widget and its test
  registerGenerateSchemaCommand(program);
  // The manifest is also written by generate:types; this stands alone so CI can
  // check it is current without paying for type and Zod generation.
  registerGenerateManifestCommand(program);

  // Migration commands. F11 was forward-only; SP-2 adds single-step rollback.
  registerMigrateCommand(program); // Imported from ./commands/migrate.js
  registerMigrateCreateCommand(program);
  registerMigrateCheckCommand(program); // F11 PR 4
  registerMigrateStatusCommand(program);
  registerMigrateBaselineCommand(program); // adopt an existing DB into the history
  registerMigrateFieldGroupsCommand(program); // rename field-group storage, previewing by default
  registerClearPlaintextPasswordsCommand(program, createContext); // clear passwords stored as given, previewing by default
  registerCreateAdminCommand(program, createContext); // create the first administrator from the CLI
  registerMigrateResolveCommand(program); // Plan C3 — recovery command
  registerPruneCommand(program); // P2b — drop orphaned plugin/code schema (D14)
  registerRepairColumnsCommand(program, createContext); // report columns whose type or nullability differs from their field
  registerWebhooksPruneCommand(program); // manual webhook-queue retention pass
  registerSetupTokenCommand(program, createContext); // replace or generate the production setup token
  registerMigrateFreshCommand(program);
  registerMigrateDownCommand(program); // SP-2 — rollback

  // i18n recovery — replay translations archived by a localization disable.
  registerI18nRestoreCommand(program);

  // Plan B — one-shot bookkeeping consolidation.
  registerUpgradeCommand(program);

  // Permissions commands
  attachCommand(program, createPermissionsCleanupCommand());
  attachCommand(program, createMediaCommand());

  // Plugin introspection (D48) — `nextly plugins list` / `info`.
  registerPluginsCommand(program);

  // Telemetry sub-command (status/enable/disable/reset)
  registerTelemetryCommand(program);
}

/**
 * Adds `command`, built on its own, as `.command()` would have built it: with
 * the program's settings (the pointer to `--help` after an error, sorted help,
 * the suggestion, the output and exit handling). `addCommand` copies none of
 * them, so a command attached that way, and every subcommand under it, would
 * answer an error or `--help` differently from the rest.
 */
function attachCommand(program: Command, command: Command): void {
  program.addCommand(command);
  inheritSettings(command, program);
}

/** Gives `command` its parent's settings, then each subcommand its own parent's. */
function inheritSettings(command: Command, parent: Command): void {
  command.copyInheritedSettings(parent);
  for (const child of command.commands) inheritSettings(child, command);
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
      const globalOpts = cmd.optsWithGlobals();
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
// registerMigrateFreshCommand is imported from ./commands/migrate-fresh.js
//
// F11 PR 2 (Q4=A): removed `migrate:down` (alias `migrate:rollback`) and
// `migrate:refresh` "not implemented" stubs. They previously printed a
// "not implemented" message; their existence implied a future rollback
// feature that the F11 spec explicitly rejects (§5 non-goals: "Forward-
// only in v1; corrective new migrations are the v1 rollback pattern").
// Operators with a typo / muscle memory now get the standard "unknown
// command" error from commander, which is the correct signal.
