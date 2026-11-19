/**
 * The declaration of `nextly upgrade`: its options and help, with the action
 * loaded from `./upgrade` only when the command runs.
 */
import { Option, type Command } from "commander";

import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

/** A flag of the database work the command used to do: accepted, hidden, and no longer read. */
const retired = (flags: string) =>
  new Option(
    flags,
    "No longer does anything: `nextly migrate` does the work it belonged to"
  ).hideHelp();

export function registerUpgradeCommand(program: Command): void {
  // `--dry-run` carries the one meaning and help line it has everywhere.
  withDryRun(
    program
      .command("upgrade [version]")
      .description(
        "Move every Nextly package of the project to one release: the one given, or the newest of the installed release's channel"
      )
  )
    // Each still parses, so a run with one ends naming `nextly migrate`
    // rather than as an unknown option.
    .addOption(retired("--confirm-backed-up"))
    .addOption(retired("-f, --force"))
    .addOption(retired("--target-table-name <name>"))
    .addOption(retired("--reconcile-core"))
    .addOption(retired("--accept-data-loss [targets]"))
    .addOption(retired("--force-unlock"))
    .action(lazyAction(async () => (await import("./upgrade")).upgradeAction));
}
