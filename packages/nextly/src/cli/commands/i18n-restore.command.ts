/**
 * The declaration of `nextly i18n:restore`: its options and help, with the
 * action loaded from `./i18n-restore` only when the command runs.
 */
import type { Command } from "commander";

import { ACCEPT_DATA_LOSS_HELP } from "../../domains/schema/migrate/data-loss-consent-help";
import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

export function registerI18nRestoreCommand(program: Command): void {
  // `--dry-run` carries the one meaning and help line it has everywhere.
  withDryRun(
    program
      .command("i18n:restore")
      .description(
        "Replay archived translations back onto an entity after a localization disable"
      )
  )
    .requiredOption(
      "--collection <slug>",
      "Collection, single, or field group slug to restore"
    )
    .option(
      "--kind <kind>",
      "collection, single or field-group: which entity the slug names, when more than one has it"
    )
    .option(
      "--locale <code>",
      "Restore only this language (default: every archived language)"
    )
    .option(
      "--field <name>",
      "Restore only this field's archived values (default: every archived field)"
    )
    .option(
      "--purge",
      "Remove the replayed rows from the archive once restored",
      false
    )
    .option("--accept-data-loss [targets]", ACCEPT_DATA_LOSS_HELP)
    .action(
      lazyAction(async () => (await import("./i18n-restore")).i18nRestoreAction)
    );
}
