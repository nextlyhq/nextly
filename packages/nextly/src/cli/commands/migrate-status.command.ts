/**
 * The declaration of `nextly migrate:status`: its options and help, with the
 * action loaded from `./migrate-status` only when the command runs.
 */
import type { Command } from "commander";

import { lazyAction } from "../lazy-action";

/**
 * Register the migrate:status command with the program
 *
 * @param program - Commander program instance
 */
export function registerMigrateStatusCommand(program: Command): void {
  program
    .command("migrate:status")
    .description("Show current migration status")
    .option("--json", "Output as JSON for scripting/CI", false)
    .option("--plugin <name>", "List <name>'s migrations instead of the app's")
    .action(
      lazyAction(
        async () => (await import("./migrate-status")).migrateStatusAction
      )
    );
}
