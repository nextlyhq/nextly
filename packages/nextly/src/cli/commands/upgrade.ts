/**
 * `nextly upgrade [version]`: moves every Nextly package of a project to one
 * release (`upgradePackages`).
 *
 * The command once brought an existing database up to date. That work is
 * `nextly migrate`'s now, which also brings Nextly's own tables up to date,
 * and the flags that belonged to it (`--confirm-backed-up`, `--force`,
 * `--reconcile-core`, `--target-table-name`, `--force-unlock`,
 * `--accept-data-loss`) are still accepted so that a run with one ends
 * naming where the work went, having changed nothing: no package, no file
 * and no table.
 *
 * @module cli/commands/upgrade
 */

import { resolve } from "node:path";

import type { Command } from "commander";

import { reportDryRun } from "../dry-run";
import { CliError, exitWithError } from "../errors";
import { createContext } from "../program";

import { upgradePackages } from "./upgrade-packages/upgrade-packages";

/**
 * How `nextly upgrade` ends, having changed nothing, when it is run with a
 * flag of the database work it used to do: each part of that work, and the
 * command that does it now.
 */
export function upgradeWorkMoved(): CliError {
  return new CliError("UPGRADE_WORK_MOVED", {
    what: "`nextly upgrade` no longer changes the database, and changed nothing.",
    why: "`nextly migrate` now moves the migration records of an earlier release, brings Nextly's own tables up to date, hashes passwords stored before this release, removes passwords kept in version history and converts roles holding a retired manage permission. `nextly i18n:convert-zoned-dates` converts translated date columns kept with a time zone. `nextly upgrade` moves the project's Nextly packages to a release, and takes none of the flags that work had.",
    next: "Run `nextly migrate` (`nextly migrate --backup-confirmed` where no terminal is attached). Once the release serves every instance, run `nextly i18n:convert-zoned-dates` if a start or `nextly migrate` named such a column. To move the packages, run `nextly upgrade` without the flag.",
  });
}

/** The flags of the database work the command used to do: none is read any more. */
export interface UpgradeCommandOptions {
  confirmBackedUp?: boolean;
  force?: boolean;
  targetTableName?: string;
  reconcileCore?: boolean;
  forceUnlock?: boolean;
  acceptDataLoss?: string | boolean;
  /** Show which packages would move, and change nothing. */
  dryRun?: boolean;
}

/** Whether the run was given a flag of the database work. */
function hasOldFlag(options: UpgradeCommandOptions): boolean {
  return (
    options.confirmBackedUp === true ||
    options.force === true ||
    options.reconcileCore === true ||
    options.forceUnlock === true ||
    options.targetTableName !== undefined ||
    (options.acceptDataLoss !== undefined && options.acceptDataLoss !== false)
  );
}

/** The action of `nextly upgrade`, loaded when it runs. */
export async function upgradeAction(
  version: string | undefined,
  cmdOptions: UpgradeCommandOptions,
  cmd: Command
): Promise<void> {
  const globalOpts = cmd.optsWithGlobals<{ cwd?: string }>();
  const { logger } = createContext(globalOpts);

  // Before anything is read: a run with one of those flags moves no package.
  if (hasOldFlag(cmdOptions)) exitWithError(logger, upgradeWorkMoved());

  try {
    await upgradePackages({
      // Absolute, so the folders above it are the project's own.
      projectDir: resolve(globalOpts.cwd ?? process.cwd()),
      version,
      dryRun: cmdOptions.dryRun === true,
      log: line => logger.info(line),
      report: plan => reportDryRun(logger, plan),
    });
  } catch (error) {
    exitWithError(logger, error);
  }
}

export { registerUpgradeCommand } from "./upgrade.command";
