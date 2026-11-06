/**
 * The declaration of `nextly migrate:field-groups`: its options and help,
 * with the action loaded from `./migrate-field-groups` only when the
 * command runs.
 */
import type { Command } from "commander";

import { lazyAction } from "../lazy-action";

export function registerMigrateFieldGroupsCommand(program: Command): void {
  program
    .command("migrate:field-groups")
    .description(
      "Preview or apply the rename of field-group storage to its current names"
    )
    .option(
      "--apply",
      "Perform the migration (without this, the command only previews)",
      false
    )
    .option("--down", "Roll a completed migration back", false)
    .option(
      "--backup-confirmed",
      "You confirm a restorable backup exists (required with --apply)",
      false
    )
    .action(
      lazyAction(
        async () =>
          (await import("./migrate-field-groups")).migrateFieldGroupsAction
      )
    );
}
