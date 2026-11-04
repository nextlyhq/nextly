/**
 * The declaration of `nextly webhooks:prune`: its options and help, with the
 * action loaded from `./webhooks-prune` only when the command runs.
 */
import type { Command } from "commander";

import { ACCEPT_DATA_LOSS_HELP } from "../../domains/schema/migrate/data-loss-consent-help";
import { lazyAction } from "../lazy-action";

/** Register the `nextly webhooks:prune` command. */
export function registerWebhooksPruneCommand(program: Command): void {
  program
    .command("webhooks:prune")
    .description(
      "Run a webhook retention pass: prune aged events and terminal deliveries"
    )
    .option(
      "--dry-run",
      "Report what a pass would remove without deleting anything",
      false
    )
    .option("--accept-data-loss [targets]", ACCEPT_DATA_LOSS_HELP)
    .action(
      lazyAction(
        async () => (await import("./webhooks-prune")).webhooksPruneAction
      )
    );
}
