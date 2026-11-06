/**
 * The declaration of `nextly migrate:fresh`: its options and help, with the
 * action loaded from `./migrate-fresh` only when the command runs.
 */
import { Option, type Command } from "commander";

import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

/**
 * Register the migrate:fresh command with the program
 *
 * @param program - Commander program instance
 */
export function registerMigrateFreshCommand(program: Command): void {
  // `--dry-run` carries the one meaning and help line it has everywhere.
  withDryRun(
    program
      .command("migrate:fresh")
      .description("Drop all tables and re-run all migrations")
  )
    .option(
      "--accept-data-loss [targets]",
      "Consent to deleting every table, for a run with no terminal; takes no targets. Same as NEXTLY_ACCEPT_DATA_LOSS=1."
    )
    // The earlier spelling of the consent, honoured for one release with a
    // notice naming --accept-data-loss, and kept out of the help.
    .addOption(
      new Option("-f, --force", "Deprecated: use --accept-data-loss")
        .default(false)
        .hideHelp()
    )
    // `--yes` answers other commands' questions and never consents to
    // deleting data, so here it is refused, naming the consent, and kept out
    // of the help.
    .addOption(
      new Option("--yes", "Refused: use --accept-data-loss").hideHelp()
    )
    .option("--seed", "Run seeders after migrations", false)
    .action(
      lazyAction(
        async () => (await import("./migrate-fresh")).migrateFreshAction
      )
    );
}
