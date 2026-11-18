/**
 * Cases for `nextly upgrade` and its steps, and for the move of an earlier
 * release's migration records that `nextly migrate` makes.
 *
 * @module cli/__tests__/error-cases/upgrade
 */
import { NextlyError } from "../../../errors/nextly-error";
import { CliError } from "../../errors";

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
  // As `backupNotConfirmed` in `cli/commands/legacy-bookkeeping.ts` throws it with no terminal to ask.
  MIGRATE_BACKUP_NOT_CONFIRMED: () =>
    new NextlyError({
      code: "NEXTLY_UPGRADE_IN_PROGRESS",
      publicMessage:
        "This database keeps its migration records the way an earlier Nextly release did, and `nextly migrate` moves them only once a backup is confirmed. " +
        "Back up the database, then run `nextly migrate --backup-confirmed`.",
      logContext: { reason: "migrate-backup-not-confirmed" },
    }),
  // As `backupDeclined` in the same module throws it for a "no" at the prompt.
  MIGRATE_BACKUP_DECLINED: () =>
    new NextlyError({
      code: "NEXTLY_UPGRADE_IN_PROGRESS",
      publicMessage:
        "The migration records of an earlier Nextly release were not moved: the backup question was answered no. " +
        "Back up the database, then run `nextly migrate` again and answer yes, or pass `--backup-confirmed`.",
      logContext: { reason: "migrate-backup-declined" },
    }),
  // As `ledgerUnreadable` in `cli/commands/legacy-bookkeeping.ts` throws it.
  MIGRATE_LEDGER_UNREADABLE: () =>
    new NextlyError({
      code: "NEXTLY_UPGRADE_TABLE_NAME_COLLISION",
      publicMessage:
        'The table "nextly_migrations" holds records `nextly migrate` cannot read: the record of 0001_init.sql has the status "rolled_back". ' +
        "Rename the table if Nextly did not create it, then run `nextly migrate` again.",
      logContext: {
        reason: "migrate-ledger-unreadable",
        table: "nextly_migrations",
      },
    }),
  // As `planMove` in the same module throws it.
  MIGRATE_EVENTS_TABLE_TAKEN: () =>
    new NextlyError({
      code: "NEXTLY_UPGRADE_TABLE_NAME_COLLISION",
      publicMessage:
        'A table named "nextly_schema_events" already exists with an unexpected ' +
        "shape. Rename it, then run `nextly migrate` again.",
      logContext: {
        reason: "migrate-events-table-taken",
        table: "nextly_schema_events",
      },
    }),
  // Retired: as `nextly upgrade` ended with it while it moved the migration records.
  UPGRADE_LEDGER_UNREADABLE: () =>
    new CliError("UPGRADE_LEDGER_UNREADABLE", {
      what: 'The table "nextly_migrations" holds records `nextly upgrade` cannot read: the record of 0001_init.sql has the status "rolled_back".',
      why: "`nextly upgrade` moves the records an earlier release kept in `nextly_migrations` into `nextly_schema_events`, and reads every one before writing any. One of them it cannot read, so nothing was changed.",
      next: "Rename the table if Nextly did not create it, then run `nextly upgrade` again.",
    }),
  // Retired: as `nextly upgrade` ended with it while it moved the migration records.
  UPGRADE_EVENTS_TABLE_TAKEN: () =>
    new CliError("UPGRADE_EVENTS_TABLE_TAKEN", {
      what: 'A table named "nextly_schema_events" already exists with an unexpected shape.',
      why: '`nextly upgrade` moves the migration records into "nextly_schema_events", and the table there does not have the columns it writes. Nothing was changed.',
      next: "Rename it, or re-run with `--target-table-name <name>`.",
    }),
} satisfies ErrorCases;
