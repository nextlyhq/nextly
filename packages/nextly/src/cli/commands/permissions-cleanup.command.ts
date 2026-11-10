/**
 * The declaration of `nextly permissions:cleanup`: its help, with the action
 * loaded from `./permissions-cleanup` only when the command runs.
 */
import { Command } from "commander";

import { ACCEPT_DATA_LOSS_HELP } from "../../domains/schema/migrate/data-loss-consent-help";
import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

/**
 * CLI command to cleanup orphaned permissions
 *
 * Usage: nextly permissions:cleanup
 */
export function createPermissionsCleanupCommand(): Command {
  // `--dry-run` carries the one meaning and help line it has everywhere.
  const command = withDryRun(
    new Command("permissions:cleanup").description(
      "Remove permissions for deleted collections and singles"
    )
  )
    .option("--accept-data-loss [targets]", ACCEPT_DATA_LOSS_HELP)
    .action(
      lazyAction(
        async () =>
          (await import("./permissions-cleanup")).permissionsCleanupAction
      )
    );

  return command;
}
