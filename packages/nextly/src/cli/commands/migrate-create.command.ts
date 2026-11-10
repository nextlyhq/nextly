/**
 * The declaration of `nextly migrate:create`: its options and help, with the
 * action loaded from `./migrate-create` only when the command runs.
 */
import type { Command } from "commander";

import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

export function registerMigrateCreateCommand(program: Command): void {
  // `--dry-run` carries the one meaning and help line it has everywhere.
  withDryRun(
    program
      .command("migrate:create")
      .description(
        "Create a new migration file from schema changes or for custom SQL"
      )
  )
    .argument("[name]", "Migration name (slug-cased, e.g., add_excerpt)")
    .option("--name <name>", "Migration name (alternate to positional arg)")
    .option("--blank", "Create an empty migration file for custom SQL", false)
    // No `--non-interactive` of its own: the program's global one, with the
    // same spelling, is what `canPrompt` reads for this command's prompts.
    .option(
      "--accept-renames",
      "ADVANCED: auto-accept all rename candidates in non-interactive mode",
      false
    )
    .option(
      "--plugin <entry>",
      "Generate the PLUGIN's migration module (path to its entry, e.g. ./src/index.ts)"
    )
    .option(
      "--record-snapshot",
      "Write a migration that changes nothing, whose snapshot records which fields are translated, for a project whose latest snapshot predates that record. Run it with the config as last migrated",
      false
    )
    .option(
      "--no-transaction",
      "Write a unit that runs outside a transaction: with --blank, a file whose first line is the marker; with --plugin, a module with transaction: false that you can edit"
    )
    .action(
      lazyAction(
        async () => (await import("./migrate-create")).migrateCreateAction
      )
    );
}
