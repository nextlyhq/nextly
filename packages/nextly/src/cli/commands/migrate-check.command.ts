/**
 * The declaration of `nextly migrate:check`: its options and help, with the
 * action loaded from `./migrate-check` only when the command runs.
 */
import type { Command } from "commander";

import { lazyAction } from "../lazy-action";

export function registerMigrateCheckCommand(program: Command): void {
  program
    .command("migrate:check")
    .description(
      "Verify migration file integrity and config drift (CI-friendly; no DB connection)"
    )
    .action(
      lazyAction(
        async () => (await import("./migrate-check")).migrateCheckAction
      )
    );
}
