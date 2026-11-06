/**
 * The declaration of `nextly migrate:down`: its options and help, with the
 * action loaded from `./migrate-down` only when the command runs.
 */
import type { Command } from "commander";

import { ACCEPT_DATA_LOSS_HELP } from "../../domains/schema/migrate/data-loss-consent-help";
import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

export function registerMigrateDownCommand(program: Command): void {
  // `--dry-run` carries the one meaning and help line it has everywhere.
  withDryRun(
    program
      .command("migrate:down")
      .description(
        "Roll back the most-recently-applied migration(s) using their -- DOWN section"
      )
  )
    .option("--step <n>", "Roll back the last N migrations", parseInt)
    .option("--accept-data-loss [targets]", ACCEPT_DATA_LOSS_HELP)
    .option("--allow-data-loss", "Deprecated: use --accept-data-loss", false)
    .option(
      "--yes",
      "Confirm rollback in production (NODE_ENV=production)",
      false
    )
    .option(
      "--force-unlock",
      "Clear a stale migrate lock before running",
      false
    )
    .option(
      "--plugin <name>",
      "Roll back <name>'s migrations instead of the app's"
    )
    .action(
      lazyAction(async () => (await import("./migrate-down")).migrateDownAction)
    );
}
