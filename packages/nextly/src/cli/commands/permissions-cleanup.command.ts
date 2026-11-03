/**
 * The declaration of `nextly permissions:cleanup`: its help, with the action
 * loaded from `./permissions-cleanup` only when the command runs.
 */
import { Command } from "commander";

import { lazyAction } from "../lazy-action";

/**
 * CLI command to cleanup orphaned permissions
 *
 * Usage: nextly permissions:cleanup
 */
export function createPermissionsCleanupCommand(): Command {
  const command = new Command("permissions:cleanup")
    .description("Remove permissions for deleted collections and singles")
    .action(
      lazyAction(
        async () =>
          (await import("./permissions-cleanup")).permissionsCleanupAction
      )
    );

  return command;
}
