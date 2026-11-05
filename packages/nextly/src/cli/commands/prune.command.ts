/**
 * The declaration of `nextly prune`: its options and help, with the action
 * loaded from `./prune` only when the command runs.
 */
import { Option, type Command } from "commander";

import { ACCEPT_DATA_LOSS_HELP } from "../../domains/schema/migrate/data-loss-consent-help";
import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

/** Register the `nextly prune` command. */
export function registerPruneCommand(program: Command): void {
  // `--dry-run` carries the one meaning and help line it has everywhere.
  withDryRun(
    program
      .command("prune")
      .description(
        "Drop orphaned plugin/code schema (retained by default — never auto-dropped)"
      )
  )
    .option("--accept-data-loss [targets]", ACCEPT_DATA_LOSS_HELP)
    // The earlier spelling of the consent, honoured for one release with a
    // notice naming --accept-data-loss, and kept out of the help.
    .addOption(
      new Option("--force", "Deprecated: use --accept-data-loss")
        .default(false)
        .hideHelp()
    )
    .action(lazyAction(async () => (await import("./prune")).pruneAction));
}
