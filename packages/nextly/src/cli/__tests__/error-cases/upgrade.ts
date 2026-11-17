/**
 * Cases for `nextly upgrade` and its steps.
 *
 * @module cli/__tests__/error-cases/upgrade
 */
import { NextlyError } from "../../../errors/nextly-error";

import type { ErrorCases } from "./types";

export const UPGRADE_CASES = {
  // As `confirmBackup` in `cli/commands/upgrade.ts` throws it for a "no" at the prompt.
  UPGRADE_CANCELLED: () =>
    new NextlyError({
      code: "NEXTLY_UPGRADE_IN_PROGRESS",
      publicMessage: "Upgrade cancelled by operator.",
      logContext: { reason: "cancelled" },
    }),
  // As the same function throws it with no terminal to ask.
  UPGRADE_BACKUP_NOT_CONFIRMED: () =>
    new NextlyError({
      code: "NEXTLY_UPGRADE_IN_PROGRESS",
      publicMessage:
        "Refusing to upgrade without a confirmed backup. Re-run with " +
        "`--confirm-backed-up` (CI/non-TTY) after backing up your database.",
      logContext: { reason: "backup-not-confirmed" },
    }),
  // As `ledgerUnreadable` in `cli/commands/upgrade-steps/schema-events.ts` throws it.
  UPGRADE_LEDGER_UNREADABLE: () =>
    new NextlyError({
      code: "NEXTLY_UPGRADE_TABLE_NAME_COLLISION",
      publicMessage:
        'The table "nextly_migrations" holds records `nextly upgrade` cannot read: the record of 0001_init.sql has the status "rolled_back". ' +
        "Rename the table if Nextly did not create it, then run `nextly upgrade` again.",
      logContext: {
        reason: "legacy-ledger-unreadable",
        table: "nextly_migrations",
      },
    }),
  // As `pending` in `cli/commands/upgrade-steps/schema-events.ts` throws it.
  UPGRADE_EVENTS_TABLE_TAKEN: () =>
    new NextlyError({
      code: "NEXTLY_UPGRADE_TABLE_NAME_COLLISION",
      publicMessage:
        'A table named "nextly_schema_events" already exists with an unexpected ' +
        "shape. Rename it, or re-run with `--target-table-name <name>`.",
      logContext: { table: "nextly_schema_events" },
    }),
} satisfies ErrorCases;
