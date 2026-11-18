/**
 * The action of `nextly migrate`, loaded when the command runs: the command's
 * options resolved with the global ones, an earlier spelling of an option
 * read as the one that replaced it, and the run started.
 *
 * Its own module, apart from `migrate.ts`, so the run is reached through that
 * module's export and a test of the command's options can stand in for it.
 *
 * @module cli/commands/migrate-action
 */
import type { Command } from "commander";

import { exitWithError } from "../errors";

import { commandRun } from "./command-run";
import { runMigrate, type MigrateCommandOptions } from "./migrate";

/** `nextly migrate`'s options as Commander hands them, earlier spellings included. */
export interface MigrateActionOptions extends MigrateCommandOptions {
  /**
   * The earlier spelling of `--backup-confirmed`, honoured for one release
   * with a notice naming the new one.
   */
  confirmBackedUp?: boolean;
}

export async function migrateAction(
  cmdOptions: MigrateActionOptions,
  cmd: Command
): Promise<void> {
  const { confirmBackedUp, ...current } = cmdOptions;
  const { context, options } = commandRun(current, cmd);
  if (confirmBackedUp === true) {
    context.logger.warn(
      "migrate's --confirm-backed-up is deprecated and will be removed: use --backup-confirmed."
    );
  }

  try {
    await runMigrate(
      {
        ...options,
        backupConfirmed:
          options.backupConfirmed === true || confirmBackedUp === true,
      },
      context
    );
  } catch (error) {
    exitWithError(context.logger, error);
  }
}
