/**
 * The declaration of `nextly upgrade`: its options and help, with the action
 * loaded from `./upgrade` only when the command runs.
 */
import type { Command } from "commander";

import { ACCEPT_DATA_LOSS_HELP } from "../../domains/schema/migrate/data-loss-consent-help";
import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

export function registerUpgradeCommand(program: Command): void {
  // `--dry-run` carries the one meaning and help line it has everywhere.
  withDryRun(
    program
      .command("upgrade")
      .description(
        "Bring an existing database up to date: move the migration records into nextly_schema_events, hash passwords stored before this release, and remove passwords kept in version history"
      )
  )
    .option(
      "--confirm-backed-up",
      "Confirm a backup exists (required in CI/non-TTY)",
      false
    )
    .option("-f, --force", "Skip the interactive backup prompt", false)
    .option(
      "--target-table-name <name>",
      "Override the events table name on a collision"
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
