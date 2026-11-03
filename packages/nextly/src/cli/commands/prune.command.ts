/**
 * The declaration of `nextly prune`: its options and help, with the action
 * loaded from `./prune` only when the command runs.
 */
import type { Command } from "commander";

import { ACCEPT_DATA_LOSS_HELP } from "../../domains/schema/migrate/data-loss-consent-help";
import { lazyAction } from "../lazy-action";

/** Register the `nextly prune` command. */
export function registerPruneCommand(program: Command): void {
  program
    .command("prune")
    .description(
      "Drop orphaned plugin/code schema (retained by default — never auto-dropped)"
    )
    .option("--accept-data-loss [targets]", ACCEPT_DATA_LOSS_HELP)
    .option("--force", "Deprecated: use --accept-data-loss", false)
    .action(lazyAction(async () => (await import("./prune")).pruneAction));
}
