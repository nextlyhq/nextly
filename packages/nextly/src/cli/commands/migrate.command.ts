/**
 * The declaration of `nextly migrate`: its options and help, with the action
 * loaded from `./migrate` only when the command runs.
 */
import type { Command } from "commander";

import { ACCEPT_DATA_LOSS_HELP } from "../../domains/schema/migrate/data-loss-consent-help";
import { withBusyTableBounds } from "../busy-table-options";
import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

/**
 * Register the migrate command with the program
 *
 * @param program - Commander program instance
 */
export function registerMigrateCommand(program: Command): void {
  // `--dry-run` and the busy-table bounds carry the one meaning and help they have everywhere.
  withBusyTableBounds(
    withDryRun(
      program
        .command("migrate")
        .description("Run all pending database migrations")
    )
  )
    .option(
      "--step <n>",
      "Run only N migrations, plugin modules and app files together",
      parseInt
    )
    .option(
      "--force-unlock",
      "Clear a stale migrate lock before running",
      false
    )
    .option("--accept-data-loss [targets]", ACCEPT_DATA_LOSS_HELP)
    .option(
      "--repair-localization",
      "Copy existing content into the translation tables of localized entities that have no record of transitioning (for installs that enabled localization before Nextly recorded it)",
      false
    )
    .action(lazyAction(async () => (await import("./migrate")).migrateAction));
}
