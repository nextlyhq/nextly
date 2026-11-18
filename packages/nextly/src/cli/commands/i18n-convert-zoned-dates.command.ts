/**
 * The declaration of `nextly i18n:convert-zoned-dates`: its options and
 * help, with the action loaded from `./i18n-convert-zoned-dates` only when
 * the command runs.
 */
import type { Command } from "commander";

import { withDryRun } from "../dry-run";
import { lazyAction } from "../lazy-action";

export function registerI18nConvertZonedDatesCommand(program: Command): void {
  // `--dry-run` carries the one meaning and help line it has everywhere.
  withDryRun(
    program
      .command("i18n:convert-zoned-dates")
      .description(
        "Convert translated date columns an earlier release made with a time zone (PostgreSQL). Run once, after the release serves every instance"
      )
  )
    .option(
      "--backup-confirmed",
      "Confirm the database is backed up (required without a terminal; ignored when there is nothing to convert)",
      false
    )
    // The command takes the schema lock, and the lock-busy error tells
    // operators to re-run with this flag, as on `nextly migrate`.
    .option(
      "--force-unlock",
      "Clear a stale migrate lock before running",
      false
    )
    .action(
      lazyAction(
        async () =>
          (await import("./i18n-convert-zoned-dates"))
            .i18nConvertZonedDatesAction
      )
    );
}
