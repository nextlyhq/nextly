/**
 * `nextly migrate:field-groups` — move field-group storage to its current names.
 *
 * Field groups were once called components, and the old vocabulary is still in the database: the
 * registry table, every field group's data table, and the column that says which field group a
 * stored row belongs to. This command renames them. Nothing about the running application changes —
 * it already reads whichever generation a database holds — so this is a tidy-up that can be done
 * per site, at a time of the operator's choosing, rather than a flag day.
 *
 * ## It previews by default, and that is the interface
 *
 * Running it with no flags writes NOTHING and prints the plan. Applying is `--apply`, and `--apply`
 * needs `--backup-confirmed` alongside it. The engine owns that requirement; this command does not
 * restate it, because two implementations of one precondition drift and the engine's is the one
 * that runs first, before it has contended for anything.
 *
 * A preview takes no lock and issues no DDL, which is what lets it run against a read-only
 * credential — the credential an operator should be previewing production with. What that gives up
 * is exclusion, so the plan is a snapshot of a database that may be moving. Both facts the engine
 * reports about that are printed rather than summarised away: whether the plan was scored against
 * this database, and what could be seen of the migration lock.
 *
 * ## What it prints, and what it refuses to print
 *
 * Renames are listed by NAME. The engine deliberately does not summarise them as a count, because a
 * run also rewrites stored rows and passes settlement gates, so any number derived from renames
 * alone understates the work while looking authoritative. This command keeps that promise: an
 * operator reading a preview is asking whether THEIR table is in the list, which a total cannot
 * answer.
 *
 * @module cli/commands/migrate-field-groups
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Command } from "commander";

// Type-only, so it is erased at runtime and does not pull the migration engine into the boot
// graph the way the value import inside the action deliberately avoids.
import { getDialectTables } from "../../database/index";
import { SchemaRegistry } from "../../database/schema-registry";
import type { MigrationOutcome } from "../../domains/field-groups/migration/run";
import { getFieldGroupRegistryAliases } from "../../domains/field-groups/storage/registry-schemas";
import { describeError } from "../../errors/index";
import { createContext, type CommandContext } from "../program";
import { validateDatabaseEnv, withAdapter } from "../utils/adapter";

export interface MigrateFieldGroupsCommandOptions {
  /** Perform the migration. Without it the command previews and writes nothing. */
  apply?: boolean;
  /** Roll a completed migration back to the previous names. */
  down?: boolean;
  /** The operator states a restorable backup exists. Required by the engine for any write. */
  backupConfirmed?: boolean;
  config?: string;
  cwd?: string;
  verbose?: boolean;
  quiet?: boolean;
}

export async function runMigrateFieldGroups(
  options: MigrateFieldGroupsCommandOptions,
  context: CommandContext
): Promise<void> {
  const { logger } = context;

  // Fail before touching the network if the database environment is unusable, matching every other
  // command that needs a connection.
  const dbValidation = validateDatabaseEnv();
  if (!dbValidation.valid) {
    for (const error of dbValidation.errors) logger.error(error);
    logger.newline();
    logger.info(
      "Set DATABASE_URL and optionally DB_DIALECT environment variables."
    );
    process.exit(1);
  }

  const dryRun = options.apply !== true;
  const direction = options.down === true ? "down" : "up";

  logger.keyValue("Direction", direction);
  logger.keyValue("Mode", dryRun ? "preview (nothing is written)" : "apply");
  logger.newline();

  await withAdapter(
    async adapter => {
      // 🔴 The engine reaches system tables through the adapter's table resolver, and a CLI process
      // has no boot to install one — so without this the run fails at the first registry read with
      // "not found in schema registry", which reads as a corrupt database rather than a missing
      // wiring step. A preview does not reveal this: it stops before the writes that resolve tables.
      //
      // BOTH spellings of the field-group registry are registered, because this command is the one
      // operation that runs while that name is changing: resolving only the name the database
      // started with leaves it with no handle the moment the rename lands.
      const drizzleAdapter = adapter as unknown as DrizzleAdapter;
      const { dialect } = drizzleAdapter.getCapabilities();
      const schemaRegistry = new SchemaRegistry(dialect);
      schemaRegistry.registerStaticSchemas({
        ...getDialectTables(dialect),
        ...getFieldGroupRegistryAliases(dialect),
      });
      drizzleAdapter.setTableResolver(schemaRegistry);

      const { runFieldGroupMigration } = await import(
        "../../domains/field-groups/migration/run"
      );

      const outcome = await runFieldGroupMigration({
        adapter: drizzleAdapter,
        logger: {
          info: (msg: string) => logger.debug(msg),
          warn: (msg: string) => logger.warn(msg),
          error: (msg: string) => logger.error(msg),
          debug: (msg: string) => logger.debug(msg),
        },
        direction,
        dryRun,
        // Passed through rather than checked here. The engine refuses first, before it has read a
        // catalog or contended for the lock, and restating that decision would make this a second
        // place it could drift from.
        backupConfirmed: options.backupConfirmed === true,
      });

      reportOutcome(outcome, logger);
    },
    { logger }
  );
}

/** Everything the engine reported, printed without being summarised into a smaller claim. */
function reportOutcome(
  outcome: MigrationOutcome,
  logger: CommandContext["logger"]
): void {
  if (outcome.ran) {
    logger.success(
      `Field-group storage migrated ${outcome.direction}. ${String(outcome.steps)} step(s) completed.`
    );
    return;
  }

  if (outcome.reason !== "dry-run") {
    logger.success(
      outcome.reason === "already-migrated"
        ? "This database is already at the current storage names. Nothing to do."
        : "There are no field groups to migrate. Nothing to do."
    );
    // Present only on a preview, and only when something holds the lock — so a database that reads
    // as settled while a run is mid-flight says so rather than looking finished.
    reportLock(outcome.lock, logger);
    return;
  }

  logger.info(
    `Preview of a ${outcome.direction} migration. Nothing was written.`
  );
  logger.newline();

  if (outcome.renames.length === 0) {
    logger.info("No storage objects would be renamed.");
  } else {
    logger.info("These storage objects would be renamed, in this order:");
    for (const rename of outcome.renames) {
      logger.info(`  ${rename.from}  ->  ${rename.to}`);
    }
    logger.newline();
    // Said plainly because the list is the honest part of the answer and also the incomplete part:
    // a run rewrites stored rows and passes settlement gates too, and those outnumber the renames.
    logger.info(
      "Renaming is not all a run does — it also rewrites stored rows — so this list is what changes name, not the whole of the work."
    );
  }

  logger.newline();
  if (outcome.basis.kind === "unreconciled") {
    // The plan could not be scored against this database, so the list above is the manifest's
    // proposal and an UPPER BOUND: some of it may already have been applied by whoever was writing.
    logger.warn(
      `This plan was NOT checked against your database (${outcome.basis.reason}).`
    );
    logger.warn(
      "Treat the list above as the most that could change rather than what will. Re-run the preview when nothing else is writing."
    );
  } else {
    logger.info("This plan was checked against your database.");
  }

  reportLock(outcome.lock, logger);

  logger.newline();
  logger.info(
    describeApplyCommand(outcome.direction) +
    " Take a backup first, then confirm it exists with --backup-confirmed."
  );
}

/** The exact command that applies what was just previewed. */
function describeApplyCommand(direction: "up" | "down"): string {
  return direction === "down"
    ? "To roll back for real, run: nextly migrate:field-groups --down --apply --backup-confirmed."
    : "To apply this for real, run: nextly migrate:field-groups --apply --backup-confirmed.";
}

/**
 * What was visible of the migration lock.
 *
 * Three states and never silence, because "nothing holds it" and "I could not look" send an
 * operator in opposite directions: the first says go ahead, the second says find out why your role
 * cannot read the lock table before you write anything.
 */
function reportLock(
  lock: { kind: string; owner?: string; reason?: string } | undefined,
  logger: CommandContext["logger"]
): void {
  if (!lock) return;
  if (lock.kind === "held") {
    logger.warn(
      `A migration is running right now${lock.owner ? ` (owner: ${lock.owner})` : ""}. What you are reading describes a database that is moving.`
    );
    return;
  }
  if (lock.kind === "unknown") {
    logger.warn(
      `The migration lock could not be read${lock.reason ? ` (${lock.reason})` : ""}, so it is unknown whether a run is in flight.`
    );
    return;
  }
  logger.info("No migration is currently running.");
}

export function registerMigrateFieldGroupsCommand(program: Command): void {
  program
    .command("migrate:field-groups")
    .description(
      "Preview or apply the rename of field-group storage to its current names"
    )
    .option(
      "--apply",
      "Perform the migration (without this, the command only previews)",
      false
    )
    .option("--down", "Roll a completed migration back", false)
    .option(
      "--backup-confirmed",
      "You confirm a restorable backup exists (required with --apply)",
      false
    )
    .action(
      async (cmdOptions: MigrateFieldGroupsCommandOptions, cmd: Command) => {
        const globalOpts = cmd.optsWithGlobals();
        const context = createContext(globalOpts);
        try {
          await runMigrateFieldGroups(
            {
              ...cmdOptions,
              config: globalOpts.config,
              verbose: globalOpts.verbose,
              quiet: globalOpts.quiet,
              cwd: globalOpts.cwd,
            },
            context
          );
        } catch (error) {
          context.logger.error(describeError(error));
          process.exit(1);
        }
      }
    );
}
