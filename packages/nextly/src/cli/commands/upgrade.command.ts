/**
 * The declaration of `nextly upgrade`: its options and help, with the action
 * loaded from `./upgrade` only when the command runs.
 */
import { Option, type Command } from "commander";

import { ACCEPT_DATA_LOSS_HELP } from "../../domains/schema/migrate/data-loss-consent-help";
import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

export function registerUpgradeCommand(program: Command): void {
  // `--dry-run` carries the one meaning and help line it has everywhere.
  withDryRun(
    program
      .command("upgrade")
      .description(
        "Reconcile drifted core schema with --reconcile-core. Its other database work is now part of `nextly migrate`"
      )
  )
    // They confirmed the backup for the work `nextly migrate` now does: still
    // accepted, so a run with one ends naming that command rather than as an
    // unknown option, and kept out of the help.
    .addOption(
      new Option(
        "--confirm-backed-up",
        "No longer does anything: `nextly migrate` does the work it confirmed"
      )
        .default(false)
        .hideHelp()
    )
    .addOption(
      new Option(
        "-f, --force",
        "No longer does anything: `nextly migrate` does the work it confirmed"
      )
        .default(false)
        .hideHelp()
    )
    // It named another table for the migration records, which `nextly
    // migrate` now moves: still accepted, answered with a notice, and kept
    // out of the help.
    .addOption(
      new Option(
        "--target-table-name <name>",
        "No longer does anything: `nextly migrate` moves the migration records"
      ).hideHelp()
    )
    .option(
      "--reconcile-core",
      "Reconcile drifted core schema, listing what it deletes and asking (or refusing without consent). Use only if `nextly migrate` reports core drift.",
      false
    )
    // What `--reconcile-core` deletes (a retired core column such as
    // `access_rules`) needs the one consent every deleting command takes.
    .option("--accept-data-loss [targets]", ACCEPT_DATA_LOSS_HELP)
    // Both upgrade paths take the shared migrate lock, and the lock-busy
    // error tells operators to re-run with this flag — so every lock-taking
    // command must register it. Same escape hatch as `nextly migrate`.
    .option(
      "--force-unlock",
      "Clear a stale migrate lock before running",
      false
    )
    .action(lazyAction(async () => (await import("./upgrade")).upgradeAction));
}
