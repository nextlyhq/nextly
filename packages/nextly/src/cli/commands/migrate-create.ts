/**
 * Migrate Create Command (F11 PR 3 rewrite)
 *
 * Implements `nextly migrate:create` per the F11 spec §6.1.
 *
 * The command reads `nextly.config.ts`, loads the latest snapshot from
 * `migrations/meta/`, computes the diff via the F4 Option E diff engine,
 * prompts the operator about possible renames via clack, generates the
 * SQL via the shared `pipeline/sql-templates/` module, and writes a
 * paired `migrations/<ts>_<slug>.sql` + `migrations/meta/<ts>_<slug>.snapshot.json`.
 *
 * Does NOT connect to a database — the diff is between the config and
 * the latest snapshot, both file-based.
 *
 * Exit codes (per spec):
 *   0 - File written.
 *   1 - Error (bad config, snapshot unreadable, prompt cancelled).
 *   2 - No changes detected (config matches latest snapshot).
 *
 * @module cli/commands/migrate-create
 * @since 1.0.0
 *
 * @example
 * ```bash
 * # Generate migration from pending schema changes
 * nextly migrate:create --name=add_excerpt
 *
 * # Generate without prompts (CI). Renames default to "decline" (DROP+ADD).
 * nextly migrate:create --name=add_excerpt --non-interactive
 *
 * # Same, but accept all renames automatically. ADVANCED — only when you've
 * # already verified the diff is rename-only.
 * nextly migrate:create --name=add_excerpt --non-interactive --accept-renames
 *
 * # Create blank migration for custom SQL
 * nextly migrate:create --name=custom_seed --blank
 * ```
 *
 * **Runtime restriction (F11):** This module is CLI-only. Do NOT import
 * it from runtime code (init/, route-handler/, dispatcher/, api/,
 * actions/, direct-api/, routeHandler.ts, next.ts). The deployed
 * Next.js app must not perform schema migrations at boot. Enforced by
 * ESLint (`no-restricted-imports`); see
 * docs/guides/production-migrations.mdx.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import type { Command } from "commander";

import { buildExtensionSchema } from "../../domains/schema/extension/build-extension-schema";
import type { SchemaContribution } from "../../domains/schema/extension/run-hooks";
import { canPrompt } from "../../domains/schema/migrate/can-prompt";
import {
  orderedMigrations,
  type PluginMigration,
} from "../../domains/schema/migrate/plugin/plugin-migration";
import { appMigrationInputs } from "../../domains/schema/migrate-create/app-migration-inputs";
import { contributedElementsOf } from "../../domains/schema/migrate-create/app-stream";
import {
  declaredPermissionsOf,
  describePermissionChange,
} from "../../domains/schema/migrate-create/declared-permissions";
import { describeSettingsChange } from "../../domains/schema/migrate-create/entity-settings";
import {
  formatBlankFile,
  formatTimestamp,
  slugify,
} from "../../domains/schema/migrate-create/format-file";
import {
  generateMigration,
  type GenerateResult,
} from "../../domains/schema/migrate-create/generate";
import {
  generateBlankPluginMigration,
  generatePluginMigration,
  type GeneratePluginMigrationResult,
} from "../../domains/schema/migrate-create/generate-plugin";
import { PromptCancelledError } from "../../domains/schema/migrate-create/prompt-renames";
import type {
  ContributedElements,
  TableSpec,
} from "../../domains/schema/pipeline/diff/types";
import { describeError } from "../../errors/index";
import { NextlyError } from "../../errors/nextly-error";
import type { PluginDefinition } from "../../plugins/plugin-context";
import { pluginAdminSlug } from "../../plugins/plugin-slug";
import { topoSortPlugins } from "../../plugins/topo-sort";
import { CORE_TABLE_NAMES } from "../../schemas/core-schema";
import type { CommandContext } from "../context";
import { projectPath, reportDryRun } from "../dry-run";
import {
  migrationCreateCancelled,
  migrationNameRequired,
  recordSnapshotNeedsAppMigration,
} from "../errors/areas/migrate-create";
import { exitWithError } from "../errors/index";
import {
  type CLIDatabaseAdapter,
  createCliAdapter,
  getDialectDisplayName,
  type MissingDatabase,
  openDryRunAdapter,
  type SupportedDialect,
} from "../utils/adapter";
import {
  requireDatabaseEnv,
  loadConfigOrExit,
} from "../utils/command-prerequisites";
import { bundleAndRequire } from "../utils/config-bundler";
import { loadConfig } from "../utils/config-loader";
import { formatDuration } from "../utils/logger";

import { commandRun } from "./command-run";

// ============================================================================
// Types
// ============================================================================

export interface MigrateCreateCommandOptions {
  /**
   * Migration name (required for non-blank). Slug-cased; the timestamp
   * prefix is added automatically.
   * @example "add_excerpt"
   */
  name?: string;

  /**
   * Create an empty migration file for custom SQL.
   * @default false
   */
  blank?: boolean;

  /**
   * Only meaningful when the run cannot prompt (`canPrompt`: no terminal,
   * `CI` set, or the global `--non-interactive`), where rename candidates are
   * otherwise declined (DROP + ADD with possible data loss). Auto-accept all
   * rename candidates. ADVANCED — verify the diff first via `migrate:create`
   * in interactive mode before flipping this on for CI.
   * @default false
   */
  acceptRenames?: boolean;

  /**
   * Generate a PLUGIN's migration module instead of the app's `.sql` file.
   * Path to the plugin's entry file (e.g. `./src/index.ts`); the module and
   * its `index.ts` barrel are written beside it under `src/migrations/`.
   */
  plugin?: string;

  /**
   * `false` (`--no-transaction`) writes a unit that runs outside a
   * transaction: a blank file whose first line is the marker, or a plugin
   * module with `transaction: false`, sealed when it loads so its SQL can be
   * edited. A generated app file is not marked, because marking changes the
   * contents its snapshot's hash was taken over.
   * @default true
   */
  transaction?: boolean;

  /**
   * Write a migration that changes nothing, whose snapshot records which fields are
   * translated, for a project whose latest snapshot was written before
   * snapshots recorded them. Refused while the config has changes to migrate.
   * The name defaults to `record_translated_fields`.
   * @default false
   */
  recordSnapshot?: boolean;

  /**
   * `--dry-run`: plan the migration as a real run does, rename questions included, print it and
   * the files it would write, and write nothing. A refusal of the plan is reported and exits 0.
   */
  dryRun?: boolean;
}

interface ResolvedMigrateCreateOptions extends MigrateCreateCommandOptions {
  /**
   * Drop the columns a plugin's scope keeps on types switched off, rather
   * than keep them (`GenerateArgs.releaseHeldBack`). Not a flag: `nextly
   * prune` sets it, after its data-loss consent.
   */
  releaseHeldBack?: boolean;
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cwd?: string;
}

// ============================================================================
// Command Implementation
// ============================================================================

/**
 * What `--record-snapshot` reads the translations tables through (`liveCompanionColumns`): the
 * database `DATABASE_URL` names, opened on the first read and closed by `close`. Nothing for any
 * other run, which stays offline.
 */
function recordModeReader(
  recording: boolean | undefined,
  dryRun: boolean | undefined
): {
  read?: (tableName: string) => Promise<readonly string[]>;
  close: () => Promise<void>;
} {
  if (recording !== true) return { close: () => Promise.resolve() };
  // A dry run opens the database read-only; one that is not there has no
  // translation tables, which is what a real run would find in the one it makes.
  let adapter: Promise<CLIDatabaseAdapter | MissingDatabase> | undefined;
  return {
    read: async tableName => {
      adapter ??= dryRun === true ? openDryRunAdapter() : createCliAdapter();
      const opened = await adapter;
      if ("missing" in opened) return [];
      const { companionColumnNames } = await import(
        "../../domains/i18n/runtime/companion-io"
      );
      return companionColumnNames(
        opened as unknown as Parameters<typeof companionColumnNames>[0],
        tableName
      );
    },
    close: async () => {
      const opened = adapter ? await adapter : undefined;
      if (opened && !("missing" in opened)) await opened.disconnect();
    },
  };
}

/**
 * The errors a plan's own checks raise when the real run would refuse: a
 * declaration or a change the checks reject, a plugin module that may not be
 * written, and the bookkeeping `migrate:baseline` must not adopt over. A dry
 * run reports these and exits 0. Anything else, such as a database that cannot
 * be reached, means the plan could not be worked out, and the dry run fails on
 * it as the real run does.
 */
const PLAN_REFUSAL_CODES: ReadonlySet<string> = new Set([
  "VALIDATION_ERROR",
  "PLUGIN_MIGRATION_ADDS_UNFILLABLE_COLUMN",
  "PLUGIN_MIGRATION_DROPS_CREATED_SCHEMA",
  "PLUGIN_SCHEMA_VERSION_NOT_ADVANCED",
  "NEXTLY_LEGACY_BOOKKEEPING_DETECTED",
  // `upgrade`'s: an events table of the wrong shape, and a backup nobody
  // confirmed.
  "NEXTLY_UPGRADE_TABLE_NAME_COLLISION",
  "NEXTLY_UPGRADE_IN_PROGRESS",
  // `migrate:resolve`'s checks: the file, its snapshot, the live schema
  // against it, and the ledger's state for the mode asked for.
  "NEXTLY_MIGRATION_RESOLVE_PRECONDITION",
  "NEXTLY_MIGRATION_FILE_MISSING",
  "NEXTLY_MIGRATION_SNAPSHOT_MISSING",
  "NEXTLY_MIGRATION_RESOLVE_DRIFT",
]);

/** The refusal a dry run reports for `error`, in the real run's own words. */
export function dryRunRefusalOf(error: unknown): string | undefined {
  if (!NextlyError.is(error) || !PLAN_REFUSAL_CODES.has(error.code)) {
    return undefined;
  }
  return error.publicMessage;
}

/**
 * Handles an error the plan's checks raised. A dry run reports it as the real run's refusal and
 * exits 0. Any other run, or an error that is no refusal, goes on as it did before the dry run
 * existed: `otherwise`, which rethrows unless the call site already ended the run itself.
 */
function stopOnPlanError(
  error: unknown,
  logger: CommandContext["logger"],
  dryRun: boolean | undefined,
  otherwise: () => never = () => {
    throw error;
  }
): never {
  const refusal = dryRun === true ? dryRunRefusalOf(error) : undefined;
  if (refusal !== undefined) {
    reportDryRun(logger, { changes: [], refusals: [refusal] });
    process.exit(0);
  }
  otherwise();
}

/**
 * What a dry run of a generated migration prints: the migration's text, then the migration and
 * its snapshot as the real run would write them, and any translation-table file beside them.
 */
function reportMigrationDryRun(
  result: GenerateResult,
  cwd: string,
  logger: CommandContext["logger"]
): void {
  const sqlFile = projectPath(cwd, result.sqlPath);
  logger.info(`${sqlFile} would hold:\n${result.sqlContent.trimEnd()}`);
  reportDryRun(logger, {
    changes: [
      { action: "write", target: sqlFile },
      { action: "write", target: projectPath(cwd, result.snapshotPath) },
      // The translation-table migration files, written after the pair.
      ...result.companionFiles.map(file => ({
        action: "write" as const,
        target: projectPath(cwd, file.path),
      })),
    ],
  });
}

/**
 * `--record-snapshot` with nothing to record exits 0, as a plain run with
 * nothing to write does: nothing to do is not a failure. The message, not the
 * code, tells it from a record to commit.
 */
function nothingToRecord(
  logger: CommandContext["logger"],
  dryRun: boolean | undefined
): never {
  logger.newline();
  logger.info(
    "Nothing to record: no snapshot here predates the record of which fields are translated."
  );
  endNothingToDo(logger, dryRun);
  process.exit(0);
}

/**
 * Where the real run has nothing to do, a dry run says the same and then ends
 * as every dry run ends, so a script can rely on its last lines.
 */
function endNothingToDo(
  logger: CommandContext["logger"],
  dryRun: boolean | undefined
): void {
  if (dryRun === true) reportDryRun(logger, { changes: [] });
}

/**
 * Whether the app stream has nothing it could possibly emit; it lives with the
 * inputs it judges, and is re-exported for the command's tests.
 */
export { nothingToGenerate } from "../../domains/schema/migrate-create/app-migration-inputs";

export async function runMigrateCreate(
  nameArg: string | undefined,
  options: ResolvedMigrateCreateOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  // The app's snapshot is the one that records translated fields; a blank
  // file and a plugin module have none.
  if (options.recordSnapshot === true && (options.blank || options.plugin)) {
    exitWithError(logger, recordSnapshotNeedsAppMigration());
  }

  if (options.plugin) {
    await runMigrateCreatePlugin(nameArg ?? options.name, options, context);
    return;
  }

  // Checked before anything is read: the flag is refused whatever the
  // config holds.
  if (options.transaction === false && !options.blank) {
    throw new NextlyError({
      code: "INVALID_INPUT",
      publicMessage:
        "--no-transaction writes a blank migration file (with --blank) or a plugin module (with --plugin). A generated migration file is not marked: marking it changes the contents its snapshot was taken over. Put the statements that need to run outside a transaction in a file of their own: nextly migrate:create --blank --no-transaction.",
      statusCode: 400,
      logContext: { reason: "no-transaction-not-blank" },
    });
  }

  const startTime = Date.now();

  logger.header("Migrate Create");

  // F11 PR 3: dialect comes from DATABASE_URL (no DB connection needed —
  // we just need to know which SQL flavor to emit). validateDatabaseEnv
  // handles the parsing without opening a connection.
  const dbValidation = requireDatabaseEnv(logger);
  const dialect = dbValidation.dialect;

  // Resolve the migration name. --name flag takes precedence over the
  // positional argument. Required for non-blank invocations.
  const name =
    options.name ??
    nameArg ??
    (options.recordSnapshot === true ? "record_translated_fields" : undefined);
  if (!options.blank && !name) {
    exitWithError(logger, migrationNameRequired());
  }

  // Load config.
  const configResult = await loadConfigOrExit(
    {
      configPath: options.config,
      cwd: options.cwd,
      debug: options.verbose,
    },
    logger
  );

  if (configResult.configPath) {
    logger.success(`Loaded config from ${configResult.configPath}`);
  } else {
    logger.warn("No config file found, using defaults");
  }

  const cwd = options.cwd ?? process.cwd();
  const migrationsDir = resolve(cwd, configResult.config.db.migrationsDir);

  logger.keyValue("Dialect", getDialectDisplayName(dialect));

  // --blank: write a stub file and exit. No diff, no prompts.
  if (options.blank) {
    await runBlankPath(
      name ?? "custom_migration",
      dialect,
      migrationsDir,
      context,
      startTime,
      options.transaction !== false,
      options.dryRun === true
    );
    return;
  }

  // Whether rename candidates may be asked about: the one answer every
  // prompt takes (terminal on stdin and stdout, no `CI`, no global
  // `--non-interactive`). Without one, renames are declined (DROP + ADD)
  // unless --accept-renames is explicit.
  const nonInteractive = !canPrompt();

  // F11 PR 3 review fix #8: surface a warning when --accept-renames was
  // passed but interactive mode is in effect. The flag is only consulted
  // by the prompt-renames helper when nonInteractive=true; silently
  // ignoring it would mislead the operator into thinking they had a
  // safety net they don't actually have.
  if (options.acceptRenames === true && !nonInteractive) {
    logger.warn(
      "--accept-renames has no effect in interactive mode. " +
        "Pass --non-interactive to use it (typically only for CI)."
    );
  }

  // The inputs every app migration is generated from, read and checked as
  // the server reads them for a Schema Builder save (`appMigrationInputs`).
  // A dry run reports a refusal of the plan and exits 0. A real run throws
  // that refusal on, for the command's handler to print; anything else (a
  // definition that cannot be read, a removed collection something still
  // depends on) ends the run here, printed in the error shape.
  let inputs: Awaited<ReturnType<typeof appMigrationInputs>>;
  try {
    inputs = await appMigrationInputs({
      config: configResult.config,
      ...(configResult.deferredExtends === undefined
        ? {}
        : { deferredExtends: configResult.deferredExtends }),
      projectRoot: cwd,
      migrationsDir,
      dialect,
      logger,
    });
  } catch (error) {
    stopOnPlanError(error, logger, options.dryRun, () => {
      if (dryRunRefusalOf(error) !== undefined) throw error;
      exitWithError(logger, error);
    });
  }
  const {
    collections,
    singles,
    components,
    metadataUpserts,
    previousMetadataUpserts,
    appStream,
    nothing,
  } = inputs;
  // Every permission the config declares, by owner, which every snapshot records; a plugin
  // release that only adds or removes one is a migration of its own. Read before the empty-schema
  // check: an app with no table yet may still declare permissions, which travel as a migration.
  const permissions = declaredPermissionsOf(configResult.config, {
    collections,
    singles,
  });
  const declaresPermissions =
    Object.keys(permissions.app).length > 0 ||
    Object.keys(permissions.plugins).length > 0;
  // A project with no tables has no translated field to record, and says so as any recording run
  // with nothing to record does, rather than suggesting --blank, which --record-snapshot refuses.
  if (nothing && options.recordSnapshot === true)
    nothingToRecord(logger, options.dryRun);
  if (nothing && !declaresPermissions) {
    logger.warn(
      "No collections, singles, components, or extension tables defined in config."
    );
    logger.info("Use --blank to create an empty migration for custom SQL.");
    endNothingToDo(logger, options.dryRun);
    return;
  }

  logger.newline();
  logger.info("Comparing config to latest snapshot...");

  // `--record-snapshot` records which fields are translated as the database holds them, so it reads
  // the translations tables, connecting only once it has one to check. Every other run stays offline.
  const live = recordModeReader(options.recordSnapshot, options.dryRun);
  let result;
  try {
    result = await generateMigration({
      name: name!,
      dialect,
      migrationsDir,
      appStream,
      defaultLocale: configResult.config.localization?.defaultLocale,
      onWarning: message => logger.warn(message),
      collections,
      singles,
      components,
      metadataUpserts,
      previousMetadataUpserts,
      permissions,
      nonInteractive,
      autoAcceptRenames: options.acceptRenames === true,
      recordSnapshot: options.recordSnapshot === true,
      liveCompanionColumns: live.read,
      dryRun: options.dryRun === true,
      releaseHeldBack: options.releaseHeldBack === true,
    });
  } catch (error) {
    // F11 PR 3 review fix #3: distinguish "operator cancelled prompt"
    // from real errors so we don't print a noisy "Failed to generate
    // migration: Cancelled by user." stack-style message.
    if (error instanceof PromptCancelledError) {
      // The prompt-renames helper already printed clack's `cancel()`
      // message before throwing; the error says what it left undone.
      exitWithError(logger, migrationCreateCancelled());
    }
    stopOnPlanError(error, logger, options.dryRun, () =>
      exitWithError(logger, error)
    );
  } finally {
    await live.close();
  }

  if (result === null && options.recordSnapshot === true) {
    nothingToRecord(logger, options.dryRun);
  }

  if (result === null) {
    logger.newline();
    logger.info(
      "No changes detected. Your config matches the latest snapshot."
    );
    // Nothing to do is not a failure: 0, as every command ends a run with
    // nothing to do.
    endNothingToDo(logger, options.dryRun);
    process.exit(0);
  }

  if (options.dryRun === true) {
    reportMigrationDryRun(result, cwd, logger);
    return;
  }

  const duration = Date.now() - startTime;
  // A settings or permissions change is written as the migration it is, below; its snapshot is
  // the record.
  if (
    options.recordSnapshot === true &&
    result.settingsChanges.length + result.permissionChanges.length > 0
  ) {
    logger.newline();
    logger.info(
      "The config's settings or permissions have changes to migrate, so they are written as a migration with no table statements, whose snapshot records which fields are translated."
    );
  } else if (options.recordSnapshot === true) {
    logger.newline();
    logger.success(`Recorded translated fields → ${result.snapshotPath}`);
    logger.success(`Migration (changes nothing) → ${result.sqlPath}`);
    logger.newline();
    logger.info("Next steps:");
    logger.item("Commit both files", 1);
    logger.item(
      "Make your change to the config, then run `nextly migrate:create --name <name>`",
      1
    );
    return;
  }
  logger.newline();
  logger.success(`Created migration → ${result.sqlPath}`);
  logger.success(`Snapshot → ${result.snapshotPath}`);
  logger.keyValue("Operations", result.operationCount);
  for (const change of result.settingsChanges) {
    logger.item(`Settings: ${describeSettingsChange(change)}`, 1);
  }
  for (const change of result.permissionChanges) {
    logger.item(`Permissions: ${describePermissionChange(change)}`, 1);
  }
  if (result.renamesAccepted > 0) {
    logger.keyValue("Renames accepted", result.renamesAccepted);
  }
  logger.newline();
  logger.divider();
  logger.success(`Migration created in ${formatDuration(duration)}`);
  logger.newline();
  logger.info("Next steps:");
  logger.item("Review the generated .sql file", 1);
  logger.item("Commit it to git alongside your nextly.config.ts changes", 1);
  logger.item("Run `nextly migrate` to apply it", 1);
}

// ============================================================================
// --blank path
// ============================================================================

async function runBlankPath(
  name: string,
  dialect: SupportedDialect,
  migrationsDir: string,
  context: CommandContext,
  startTime: number,
  transaction: boolean,
  dryRun: boolean
): Promise<void> {
  const { logger } = context;

  const now = new Date();
  const baseName = `${formatTimestamp(now)}_${slugify(name)}`;
  const sqlPath = resolve(migrationsDir, `${baseName}.sql`);

  // F11 PR 3 review fix #7: pass the slug-only name (not the timestamp-
  // prefixed baseName) so the file's `-- Migration:` header matches the
  // non-blank path's convention (e.g. "-- Migration: custom_seed", not
  // "-- Migration: 20260429_154500_123_custom_seed").
  const content = formatBlankFile(slugify(name), dialect, now, {
    transaction,
  });
  // A dry run prints the file and its path, and writes neither the file nor its folder.
  if (dryRun) {
    const sqlFile = projectPath(context.cwd, sqlPath);
    logger.info(`${sqlFile} would hold:\n${content.trimEnd()}`);
    reportDryRun(logger, { changes: [{ action: "write", target: sqlFile }] });
    return;
  }
  await mkdir(migrationsDir, { recursive: true });
  await writeFile(sqlPath, content, "utf-8");

  // F11 PR 3: blank migrations don't get a paired snapshot file. The
  // operator-authored SQL has no schema diff to capture; the next
  // `migrate:create` will diff against whatever the latest non-blank
  // snapshot is. (If they later want migrate:check to verify a hash for
  // their hand-written file, they can manually edit the snapshot — but
  // that's an advanced workflow and out of v1 scope.)

  const duration = Date.now() - startTime;
  logger.newline();
  logger.success(`Created blank migration → ${sqlPath}`);
  logger.newline();
  logger.divider();
  logger.success(`Blank migration created in ${formatDuration(duration)}`);
  logger.newline();
  logger.info("Edit the migration file to add your custom SQL.");
}

// ============================================================================
// Command Registration
// ============================================================================

// ============================================================================
// Plugin migrations (`--plugin <entry>`)
// ============================================================================

/**
 * A plugin's modules are bundled next to the code they migrate, so the same
 * externals list that keeps a config load off the CLI's dependency tree keeps
 * a plugin load off it too.
 */
const PLUGIN_BUNDLE_EXTERNALS = [
  "nextly",
  "@nextlyhq/*",
  "drizzle-orm",
  "drizzle-orm/*",
  "next",
  "next/*",
  "react",
  "react-dom",
  "node:*",
];

const PLUGIN_DIALECTS: SupportedDialect[] = ["postgresql", "mysql", "sqlite"];

/**
 * Compile this plugin's schema with its declared dependencies present.
 *
 * `migrate:create --plugin` emits a module that ships INSIDE the plugin, so it
 * must describe the same schema in every app that installs it. That is why the
 * app's entity tables are not in the draft, and why the emitted module is
 * filtered to the tables this plugin owns.
 *
 * Declared dependencies are the one thing that rule does not exclude. A
 * `dependsOn` entry pins a version, so a dependency's tables are as fixed a
 * fact for this plugin as its own — which is why `addColumns` permits a plugin
 * to contribute to "a declared dependency's tables", and why boot accepts such
 * a hook. Compiling the plugin alone made that hook die on `Table "x" does not
 * exist`, so a plugin using a documented feature could run in development and
 * never generate a production migration.
 *
 * The dependencies are here so the hook RESOLVES, not so their tables ship:
 * the caller keeps only this plugin's own tables. The contributed column
 * travels the same road every cross-owner element travels in this codebase —
 * the app's migration stream, with a per-element owner row naming the
 * contributor.
 */
async function buildPluginDraft(args: {
  dialect: SupportedDialect;
  pluginName: string;
  pluginPrefixes: ReadonlyMap<string, string>;
  tables: SchemaContribution["tables"];
  extend: SchemaContribution["extend"];
  dependencies: ReadonlyMap<string, ReadonlySet<string>>;
  dependencyPlugins: readonly PluginDefinition[];
}) {
  try {
    return await buildExtensionSchema({
      dialect: args.dialect,
      coreTableNames: CORE_TABLE_NAMES,
      entities: [],
      // Written into a migration, so a hook whose output moves between builds
      // would make every run write a new one: refused, naming it.
      refuseNondeterministicHooks: true,
      pluginPrefixes: args.pluginPrefixes,
      dependencies: args.dependencies,
      plugins: [
        ...args.dependencyPlugins.map(dependency => ({
          owner: { kind: "plugin" as const, id: dependency.name },
          tables: dependency.contributes?.schema?.tables ?? [],
          extend: dependency.contributes?.schema?.extend ?? [],
        })),
        {
          owner: { kind: "plugin" as const, id: args.pluginName },
          tables: args.tables,
          extend: args.extend,
        },
      ],
    });
  } catch (error) {
    const missing = missingExtendTarget(error);
    if (missing === undefined) throw error;
    // What happens to an element on an app's entity table is stated as the
    // code does it: the app's migration stream carries every contribution to
    // its collections, Singles and field groups (and to the extendable core
    // tables), whoever made it — so the plugin's module never needs one, and
    // the hook only has to tolerate the table's absence here.
    throw NextlyError.invalidInput({
      message:
        `Plugin "${args.pluginName}" has a schema.extend hook that extends "${missing}", ` +
        `which is not in the schema this command compiles. A plugin's migration module ships ` +
        `inside the plugin, so it is compiled from the plugin and its DECLARED DEPENDENCIES ` +
        `alone — never from the app's entity tables, which differ per installation. ` +
        `If "${missing}" belongs to a dependency, add that dependency to dependsOn and make sure ` +
        `it is present in the config this command loads. If it is one of the app's collections, ` +
        `Singles or field groups, what the hook adds to it is migrated by the APP: \`nextly migrate:create\` ` +
        `in the app writes it, whoever contributed it. Guard the hook with ` +
        `\`schema.getTable("${missing}")\` so it skips the table when compiled for this module.`,
      logContext: { reason: "plugin-extend-target-outside", target: missing },
    });
  }
}

/** Every plugin a plugin declares it depends on, required or optional. */
function declaredDependencies(plugin: PluginDefinition): string[] {
  return [
    ...Object.keys(plugin.dependsOn ?? {}),
    ...Object.keys(plugin.optionalDependsOn ?? {}),
  ];
}

/** The table prefix a plugin's declared tables compile under. */
function schemaPrefixOf(plugin: PluginDefinition): string {
  return (
    plugin.contributes?.schema?.prefix ??
    pluginAdminSlug(plugin.name).replace(/-/g, "_")
  );
}

/**
 * The plugins compiled beside `target` when its migration module is generated:
 * its dependencies, THEIR dependencies, and so on, in dependency order.
 *
 * Direct dependencies alone are not enough. When C depends on B and B's hook
 * extends a table of B's own dependency A, compiling C runs B's hook, and that
 * hook needs A's table in the draft and B's dependency edge on A — without
 * them it fails on `Table "x" does not exist` although boot, which compiles
 * every plugin, resolves the same graph. So the closure is walked through
 * every declared dependency that is configured, and the dependency map and the
 * prefixes cover every plugin in it, not only the target.
 *
 * Ordered by `topoSortPlugins`, the sort boot uses, so a missing required
 * dependency or a cycle is refused with the error boot would give. An optional
 * dependency the config does not carry is left out, as boot leaves it out.
 * `target` replaces any configured entry of the same name: the module is
 * generated from the plugin entry on disk, not from the copy the app installs.
 */
export function pluginDependencyClosure(
  target: PluginDefinition,
  configured: readonly PluginDefinition[]
): {
  dependencyPlugins: PluginDefinition[];
  dependencies: Map<string, ReadonlySet<string>>;
  pluginPrefixes: Map<string, string>;
} {
  const byName = new Map(configured.map(plugin => [plugin.name, plugin]));
  byName.set(target.name, target);

  const members = new Map<string, PluginDefinition>([[target.name, target]]);
  const pending = [target];
  for (let plugin = pending.pop(); plugin; plugin = pending.pop()) {
    for (const name of declaredDependencies(plugin)) {
      const dependency = byName.get(name);
      if (!dependency || members.has(name)) continue;
      members.set(name, dependency);
      pending.push(dependency);
    }
  }

  const ordered = topoSortPlugins([...members.values()]);
  return {
    dependencyPlugins: ordered.filter(plugin => plugin.name !== target.name),
    dependencies: new Map(
      ordered.map(plugin => [
        plugin.name,
        new Set(declaredDependencies(plugin)),
      ])
    ),
    pluginPrefixes: new Map(
      ordered.map(plugin => [plugin.name, schemaPrefixOf(plugin)])
    ),
  };
}

/**
 * The table a draft refusal says could not be extended, if that is what it says.
 *
 * Exported so the recognition can be tested against the refusal the draft
 * actually raises: this reads another module's message, and a change there
 * turns the plugin's explanation back into a raw validation error silently.
 */
export function missingExtendTarget(error: unknown): string | undefined {
  if (!(error instanceof NextlyError)) return undefined;
  const errors = (
    error.publicData as { errors?: { message?: string }[] } | undefined
  )?.errors;
  for (const entry of errors ?? []) {
    // Anchored at the start only: the refusal goes on to say which tables a
    // hook can see, and that sentence is not part of what identifies it.
    const match =
      /^Table "(.+?)" does not exist, so it cannot be extended\./.exec(
        entry.message ?? ""
      );
    if (match) return match[1];
  }
  return undefined;
}

/** Whether a module export is a plugin definition rather than, say, a table. */
function isPluginDefinition(
  value: unknown
): value is Partial<PluginDefinition> {
  // `name` alone is not enough: a `defineTable` result carries a name too.
  // `version` is required of every plugin and of no table.
  const candidate = value as { name?: unknown; version?: unknown } | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.name === "string" &&
    typeof candidate.version === "string"
  );
}

/**
 * The plugin definition a `--plugin` entry exports.
 *
 * The documented shapes all work: a default export, a module that IS the
 * definition, or a named export such as `export const myPlugin =
 * definePlugin(...)` beside the tables it declares. A module exporting two
 * plugins is refused by name, because generating for one of them silently
 * would attribute the migrations to a plugin the author did not choose.
 */
function pluginDefinitionFrom(
  mod: Record<string, unknown>,
  entry: string
): Partial<PluginDefinition> | undefined {
  if (isPluginDefinition(mod.default)) return mod.default;
  // Named exports before the module itself: an ESM entry exporting plain
  // `name` and `version` strings beside its plugin would otherwise read as
  // the plugin. A CommonJS `module.exports = definePlugin(...)` exports no
  // plugin by name, so it still reaches the last case.
  const named = Object.entries(mod).filter(([, value]) =>
    isPluginDefinition(value)
  );
  if (named.length > 1) {
    throw NextlyError.invalidInput({
      message: `The plugin entry ${entry} exports more than one plugin (${named
        .map(([key]) => key)
        .join(
          ", "
        )}). Point --plugin at a file that exports one, or export it as the default.`,
      logContext: { reason: "plugin-entry-exports-several", entry },
    });
  }
  if (named.length === 1) return named[0][1] as Partial<PluginDefinition>;
  return isPluginDefinition(mod) ? mod : undefined;
}

/** A plugin definition carrying the two fields generation cannot do without. */
type GeneratablePlugin = Partial<PluginDefinition> & {
  name: string;
  schemaVersion: number;
};

/**
 * Load a `--plugin` entry and the definition it exports, refusing one with
 * no name or no schemaVersion.
 */
async function loadPluginEntry(
  entryPath: string,
  cwd: string
): Promise<GeneratablePlugin> {
  const { mod } = await bundleAndRequire({
    filepath: entryPath,
    cwd: dirname(entryPath),
    external: PLUGIN_BUNDLE_EXTERNALS,
  });
  const definition = pluginDefinitionFrom(mod, relative(cwd, entryPath));

  if (!definition?.name) {
    throw new NextlyError({
      code: "INVALID_INPUT",
      publicMessage: `The plugin entry ${relative(cwd, entryPath)} exports no definition with a name, so its migrations cannot be attributed.`,
      statusCode: 400,
      logContext: { reason: "plugin-entry-unnamed" },
    });
  }
  if (typeof definition.schemaVersion !== "number") {
    throw new NextlyError({
      code: "INVALID_INPUT",
      publicMessage: `Plugin "${definition.name}" declares no schemaVersion. A plugin needs one before migrations can be generated for it.`,
      statusCode: 400,
      logContext: { reason: "plugin-schema-version-missing" },
    });
  }
  return definition as GeneratablePlugin;
}

/**
 * The plugin's declared tables and its schema hooks.
 *
 * The HOOKS as well as the declarative tables. `schema.addTable()` inside
 * `schema.extend` is a documented way to declare one — boot compiles and
 * pushes whatever it produces — and passing only `tables` here generated an
 * empty module for such a plugin. The table then existed through dev push
 * and was missing after a production migration, which is the one difference
 * migrations exist to prevent.
 *
 * A hook reaching for an ENTITY table finds none: this command compiles the
 * plugin alone, deliberately, because a plugin's migration must not depend
 * on which app installs it. Such a hook is refused by name here rather than
 * silently producing a module without it.
 */
function pluginSchemaOf(definition: GeneratablePlugin): {
  tables: SchemaContribution["tables"];
  extend: SchemaContribution["extend"];
} {
  return {
    tables: definition.contributes?.schema?.tables ?? [],
    extend: definition.contributes?.schema?.extend ?? [],
  };
}

/**
 * Modules the plugin already ships; empty on first generation.
 *
 * "Absent" is decided by asking whether the barrel EXISTS, not by catching
 * whatever loading it throws. Treating every failure as a first generation
 * meant a barrel with a syntax error, a bad import or a throwing module read
 * as "no history" — and generation then rewrote `index.ts` to export only
 * the new module, orphaning every migration the plugin had shipped. The next
 * deployment either skips modules it needs or reconciles against a snapshot
 * that no longer describes anything.
 */
async function loadShippedMigrations(
  migrationsDir: string,
  cwd: string
): Promise<PluginMigration[]> {
  const barrelPath = resolve(migrationsDir, "index.ts");
  if (!existsSync(barrelPath)) return [];
  let loaded;
  try {
    loaded = await bundleAndRequire({
      filepath: barrelPath,
      cwd: migrationsDir,
      external: PLUGIN_BUNDLE_EXTERNALS,
    });
  } catch (error) {
    throw new NextlyError({
      code: "INVALID_INPUT",
      publicMessage:
        `The plugin's existing migrations barrel at ${relative(cwd, barrelPath)} could not be loaded: ${describeError(error)}. ` +
        `Generation stops here rather than treating it as a first generation — doing that would rewrite the barrel and orphan the modules it lists. ` +
        `Fix the barrel (or the module it imports) and run this again.`,
      statusCode: 400,
      logContext: {
        reason: "plugin-migrations-barrel-unreadable",
        barrel: relative(cwd, barrelPath),
        detail: describeError(error),
      },
    });
  }
  const shipped = (loaded.mod as { migrations?: PluginMigration[] }).migrations;
  return orderedMigrations(shipped ?? []);
}

/** Where a plugin's module is being generated, and from what. */
interface PluginGeneration {
  definition: GeneratablePlugin;
  name: string | undefined;
  cwd: string;
  migrationsDir: string;
  existing: PluginMigration[];
  options: ResolvedMigrateCreateOptions;
  logger: CommandContext["logger"];
}

/**
 * A blank module, for SQL the author adds. Compiled like a generated one, so
 * it records the change the declared schema makes, if any, for that SQL to
 * carry out (`buildBlankPluginMigration`).
 */
async function writeBlankPluginMigration(
  generation: PluginGeneration,
  compiled: Awaited<ReturnType<typeof compilePluginDialects>>
): Promise<void> {
  const { definition, cwd, logger } = generation;
  const blank = await generateBlankPluginMigration({
    ...compiled,
    pluginName: definition.name,
    schemaVersion: definition.schemaVersion,
    name: generation.name ?? "migration",
    migrationsDir: generation.migrationsDir,
    existing: generation.existing,
    transaction: generation.options.transaction,
    dryRun: generation.options.dryRun === true,
  });
  if (generation.options.dryRun === true) {
    reportPluginDryRun(blank, cwd, logger);
    return;
  }
  logger.success(`Created ${relative(cwd, blank.modulePath)}`);
  logger.info(`Rewrote ${relative(cwd, blank.indexPath)}`);
  logger.info(
    "Add the module's SQL to each dialect's `up` and `down`. It is sealed with `migrationChecksum` when it loads, so editing it keeps it intact."
  );
}

/**
 * The entry's definition as the dependency closure takes it.
 *
 * `version` and `nextly` are required by the definition type and read by
 * nothing here: the closure orders by name and dependency maps alone. The
 * entry is only checked for a name and a schemaVersion, so an absent value is
 * carried as empty rather than refused.
 */
function closureTargetOf(definition: GeneratablePlugin): PluginDefinition {
  return {
    ...definition,
    name: definition.name,
    version: definition.version ?? "",
    nextly: definition.nextly ?? "",
  };
}

/**
 * The app's config, read ONLY to find the dependency definitions this plugin
 * declares. Its collections and entity tables are deliberately not compiled
 * — a plugin's module must not vary with the app that generates it.
 */
async function configuredPluginsFor(
  target: PluginDefinition,
  options: ResolvedMigrateCreateOptions,
  cwd: string
): Promise<readonly PluginDefinition[]> {
  if (declaredDependencies(target).length === 0) return [];
  return (
    (await loadConfig({ configPath: options.config, cwd })).config.plugins ?? []
  );
}

/** What every per-dialect draft of one plugin is compiled from. */
type PluginDraftInput = Omit<Parameters<typeof buildPluginDraft>[0], "dialect">;
type PluginDraft = Awaited<ReturnType<typeof buildPluginDraft>>;

/** One dialect's share of the plugin module. */
interface PluginDialectTables {
  tables: TableSpec[];
  contributed: TableSpec[];
  contributedBaseline: TableSpec[];
  contributions: Record<string, ContributedElements>;
}

/** The tables this plugin OWNS on one dialect. */
function ownedTableNames(built: PluginDraft, pluginName: string): Set<string> {
  return new Set(
    built.tables
      .filter(
        table => table.owner.kind === "plugin" && table.owner.id === pluginName
      )
      .map(table => table.name)
  );
}

/**
 * Tables somebody else owns that carry an ELEMENT this plugin contributed,
 * with those elements.
 *
 * Filtering by table owner alone dropped these, and with them the column
 * the plugin added to its dependency's table — so the contribution existed
 * at boot and could never reach an installation that only applies shipped
 * modules. A plugin ships its own migrations so installing it does not
 * require the app to regenerate; a column missing from them is a column
 * that never arrives.
 */
function foreignElementsOf(
  built: PluginDraft,
  owned: ReadonlySet<string>,
  pluginName: string
): Map<string, ElementOwnerOf<PluginDraft>[]> {
  return new Map(
    [...built.elementOwners.entries()]
      .filter(([table]) => !owned.has(table))
      .map(
        ([table, elements]) =>
          [
            table,
            elements.filter(
              element =>
                element.owner.kind === "plugin" &&
                element.owner.id === pluginName
            ),
          ] as const
      )
      .filter(([, elements]) => elements.length > 0)
  );
}

/** An element-owner row of a compiled draft. */
type ElementOwnerOf<Draft extends PluginDraft> =
  Draft["elementOwners"] extends Map<string, Array<infer Element>>
    ? Element
    : never;

/** Compile one dialect's tables, contributions and foreign baselines. */
async function compilePluginDialect(
  dialect: SupportedDialect,
  draft: PluginDraftInput
): Promise<PluginDialectTables> {
  const built = await buildPluginDraft({ dialect, ...draft });
  // The tables this plugin OWNS. Its module creates exactly these — never
  // an app's table, and never a dependency's.
  const owned = ownedTableNames(built, draft.pluginName);
  const mine = foreignElementsOf(built, owned, draft.pluginName);
  // By name, for the module to record: the next generation reads which
  // elements were this plugin's from here, never from the stored tables.
  // Per dialect: a hook may add an element on one dialect only.
  const contributions: Record<string, ContributedElements> = {};
  for (const [table, elements] of mine) {
    contributions[table] = contributedElementsOf(elements);
  }

  // Every table this plugin does not own, as its OWN owner declares it —
  // compiled without this plugin's hooks. Both sides of the foreign-table
  // diff are built on it, so the module emits the added column rather than a
  // CREATE TABLE for a table it does not own, and emits the drop when this
  // plugin stops contributing. Only a plugin with dependencies can have a
  // foreign table at all.
  const contributedBaseline =
    draft.dependencyPlugins.length > 0
      ? (
          await buildPluginDraft({ dialect, ...draft, extend: [] })
        ).specs.filter(spec => !owned.has(spec.name))
      : [];

  return {
    tables: built.specs.filter(spec => owned.has(spec.name)),
    contributed: built.specs.filter(spec => mine.has(spec.name)),
    contributedBaseline,
    contributions,
  };
}

/** Every dialect's share of the plugin module, keyed by dialect. */
async function compilePluginDialects(draft: PluginDraftInput): Promise<{
  tablesByDialect: Record<SupportedDialect, TableSpec[]>;
  contributedByDialect: Record<SupportedDialect, TableSpec[]>;
  contributedBaselineByDialect: Record<SupportedDialect, TableSpec[]>;
  contributions: Partial<
    Record<SupportedDialect, Record<string, ContributedElements>>
  >;
}> {
  const tablesByDialect = {} as Record<SupportedDialect, TableSpec[]>;
  const contributedByDialect = {} as Record<SupportedDialect, TableSpec[]>;
  const contributedBaselineByDialect = {} as Record<
    SupportedDialect,
    TableSpec[]
  >;
  const contributions: Partial<
    Record<SupportedDialect, Record<string, ContributedElements>>
  > = {};
  for (const dialect of PLUGIN_DIALECTS) {
    const compiled = await compilePluginDialect(dialect, draft);
    tablesByDialect[dialect] = compiled.tables;
    contributedByDialect[dialect] = compiled.contributed;
    contributions[dialect] = compiled.contributions;
    contributedBaselineByDialect[dialect] = compiled.contributedBaseline;
  }
  return {
    tablesByDialect,
    contributedByDialect,
    contributedBaselineByDialect,
    contributions,
  };
}

/**
 * What a dry run of a plugin module prints: the module's text, then the module and the barrel as
 * the real run would write them. The barrel is rewritten whole, so it is an edit where one is
 * already there.
 */
function reportPluginDryRun(
  planned: Pick<
    GeneratePluginMigrationResult,
    "modulePath" | "moduleContent" | "indexPath"
  >,
  cwd: string,
  logger: CommandContext["logger"]
): void {
  const moduleFile = projectPath(cwd, planned.modulePath);
  logger.info(`${moduleFile} would hold:\n${planned.moduleContent.trimEnd()}`);
  reportDryRun(logger, {
    changes: [
      { action: "write", target: moduleFile },
      {
        action: existsSync(planned.indexPath) ? "edit" : "write",
        target: projectPath(cwd, planned.indexPath),
      },
    ],
  });
}

/** Report a generated module: its path, each dialect's count, the barrel. */
function reportPluginMigration(
  result: NonNullable<Awaited<ReturnType<typeof generatePluginMigration>>>,
  cwd: string,
  logger: CommandContext["logger"]
): void {
  logger.success(`Created ${relative(cwd, result.modulePath)}`);
  for (const dialect of PLUGIN_DIALECTS) {
    logger.info(
      `  ${getDialectDisplayName(dialect)}: ${result.operationCounts[dialect]} operation(s)`
    );
  }
  logger.info(`Rewrote ${relative(cwd, result.indexPath)}`);
  if (result.handWritten.length > 0) {
    logger.warn(
      `${result.handWritten.map(getDialectDisplayName).join(", ")} cannot make this change in place, so the module has no SQL for ${result.handWritten.length === 1 ? "it" : "them"}. ` +
        "Write each one's `up` and `down` in the module (on SQLite, a rebuild of the table: create it anew, copy the rows, drop the old one, rename the new one into place). " +
        "The module already records the schema before and after the change, so the next generation starts from the changed shape. " +
        "`nextly migrate` refuses to run it on a dialect whose `up` is still empty."
    );
  }
}

/**
 * Generate one plugin's migration module: compile the plugin's declared
 * tables per dialect, diff against the previous module's snapshot, and write
 * the module plus the rewritten `index.ts` barrel beside the entry.
 */
async function runMigrateCreatePlugin(
  name: string | undefined,
  options: ResolvedMigrateCreateOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;
  const cwd = options.cwd ?? process.cwd();
  const entryPath = resolve(cwd, options.plugin!);
  const migrationsDir = resolve(dirname(entryPath), "migrations");

  const definition = await loadPluginEntry(entryPath, cwd);
  const { tables, extend } = pluginSchemaOf(definition);
  const existing = await loadShippedMigrations(migrationsDir, cwd);

  // Declared dependencies, compiled ALONGSIDE this plugin.
  //
  // `extendTable` on a dependency's table is a supported contribution —
  // `addColumns` permits "a plugin on a declared dependency's tables" — and
  // boot allows it because every plugin is compiled together there. This
  // command compiled the plugin alone, so the target was simply absent and the
  // hook died on `Table "x" does not exist`: valid in development, impossible
  // to generate a migration for.
  //
  // The dependency's tables go into the DRAFT so the hook resolves, and never
  // into the emitted module — the `owned` filter keeps this module to the
  // tables this plugin's stream owns. The contributed COLUMN reaches
  // production the way every cross-owner element does in this codebase: on the
  // app's migration stream, with a per-element owner row naming the
  // contributor (see `recordElementOwners` in migrate.ts). A plugin module
  // carrying a column on a table it does not own would be a second answer to
  // a question that already has one.
  //
  // The dependencies' own dependencies come too, since a dependency's hook
  // can reach into a table of its own dependency (see
  // `pluginDependencyClosure`).
  const target = closureTargetOf(definition);
  const configured = await configuredPluginsFor(target, options, cwd);
  const { dependencyPlugins, dependencies, pluginPrefixes } =
    pluginDependencyClosure(target, configured);

  // What the compile and the module's checks refuse ends the run, and a dry run reports it.
  const planned = <T>(work: () => Promise<T>): Promise<T> =>
    work().catch(error => stopOnPlanError(error, logger, options.dryRun));

  const {
    tablesByDialect,
    contributedByDialect,
    contributedBaselineByDialect,
    contributions,
  } = await planned(() =>
    compilePluginDialects({
      pluginName: definition.name,
      pluginPrefixes,
      tables,
      extend,
      dependencies,
      // Dependencies FIRST, and among them each before its dependents:
      // `runExtensionHooks` takes the list already topologically sorted, and a
      // hook cannot extend a table the draft has not been told about yet.
      dependencyPlugins,
    })
  );

  if (options.blank) {
    await planned(() =>
      writeBlankPluginMigration(
        {
          definition,
          name,
          cwd,
          migrationsDir,
          existing,
          options,
          logger,
        },
        {
          tablesByDialect,
          contributedByDialect,
          contributedBaselineByDialect,
          contributions,
        }
      )
    );
    return;
  }

  const result = await planned(() =>
    generatePluginMigration({
      contributedByDialect,
      contributedBaselineByDialect,
      contributions,
      pluginName: definition.name,
      schemaVersion: definition.schemaVersion,
      name: name ?? "migration",
      migrationsDir,
      tablesByDialect,
      existing,
      transaction: options.transaction,
      // A module that runs outside a transaction is written to be edited:
      // its generated `CREATE INDEX` is what becomes `CREATE INDEX
      // CONCURRENTLY`.
      handSealed: options.transaction === false,
      dryRun: options.dryRun === true,
    })
  );

  if (!result) {
    logger.info(
      `No schema changes detected for plugin "${definition.name}" — nothing to generate.`
    );
    // Nothing to do, which is not a failure.
    endNothingToDo(logger, options.dryRun);
    process.exit(0);
  }

  if (options.dryRun === true) {
    reportPluginDryRun(result, cwd, logger);
    return;
  }
  reportPluginMigration(result, cwd, logger);
}

/**
 * The action of `nextly migrate:create`, loaded when it runs.
 */
export async function migrateCreateAction(
  positionalName: string | undefined,
  cmdOptions: MigrateCreateCommandOptions,
  cmd: Command
): Promise<void> {
  const { context, options } = commandRun(cmdOptions, cmd);
  const resolvedOptions: ResolvedMigrateCreateOptions = options;

  try {
    await runMigrateCreate(positionalName, resolvedOptions, context);
  } catch (error) {
    exitWithError(context.logger, error);
  }
}

export { registerMigrateCreateCommand } from "./migrate-create.command";
