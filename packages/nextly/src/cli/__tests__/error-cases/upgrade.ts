/**
 * Cases for `nextly upgrade`, for the steps over data an earlier release
 * stored, and for the move of an earlier release's migration records that
 * `nextly migrate` makes.
 *
 * @module cli/__tests__/error-cases/upgrade
 */
import { NextlyError } from "../../../errors/nextly-error";
import { upgradeWorkMoved } from "../../commands/upgrade";
import {
  cannotStart,
  installFailed,
  notRestored,
  packagesCannotMove,
  releaseUnknown,
} from "../../commands/upgrade-packages/upgrade-refusals";
import { CliError } from "../../errors";

import type { ErrorCases } from "./types";

export const UPGRADE_CASES = {
  // Retired: as `nextly upgrade` ended with it for a "no" at its backup prompt.
  UPGRADE_CANCELLED: () =>
    new CliError("UPGRADE_CANCELLED", {
      what: "Upgrade cancelled by operator.",
      why: "The upgrade asks for a backup before its first step that changes anything, and the answer was no. Nothing was changed.",
      next: "Back up the database, then run `nextly upgrade` again and answer yes.",
    }),
  // Retired: as `nextly upgrade` ended with it with no terminal to ask.
  UPGRADE_BACKUP_NOT_CONFIRMED: () =>
    new CliError("UPGRADE_BACKUP_NOT_CONFIRMED", {
      what: "Refusing to upgrade without a confirmed backup.",
      why: "No terminal is attached to ask whether the database is backed up, and `--confirm-backed-up` was not passed. Nothing was changed.",
      next: "Re-run with `--confirm-backed-up` (CI/non-TTY) after backing up your database.",
    }),
  // As `readProject` in `cli/commands/upgrade-packages/upgrade-packages.ts` refuses a folder with no manifest.
  UPGRADE_CANNOT_START: () =>
    cannotStart(
      "No `package.json` could be read in /srv/app.",
      "Run `nextly upgrade` in the project's folder, or name it with `--cwd`."
    ),
  // As `upgradePackages` refuses a release that is not published.
  UPGRADE_RELEASE_UNKNOWN: () =>
    releaseUnknown({
      kind: "refused",
      why: { reason: "not-published", given: "0.0.2-beta.9" },
      wouldChoose: "0.0.2-alpha.79",
      tags: [
        { tag: "alpha", version: "0.0.2-alpha.79" },
        { tag: "latest", version: "0.0.2-alpha.78" },
      ],
    }),
  // As `assertEveryPackageCanMove` in the same module refuses before anything changes.
  UPGRADE_PACKAGE_CANNOT_MOVE: () =>
    packagesCannotMove("0.0.2-alpha.79", [
      "@nextlyhq/plugin-seo is declared as `workspace:*`, which is not a version of the registry.",
    ]),
  // As `restoreAndFail` in the same module ends a run it put back.
  UPGRADE_INSTALL_FAILED: () =>
    installFailed({
      manager: "pnpm",
      version: "0.0.2-alpha.79",
      output:
        "ERR_PNPM_FETCH_500 GET https://registry.npmjs.org/@nextlyhq/admin: Internal Server Error",
    }),
  // As the same function ends a run whose second install did not put the packages back.
  UPGRADE_NOT_RESTORED: () =>
    notRestored({
      manager: "pnpm",
      version: "0.0.2-alpha.79",
      output:
        "ERR_PNPM_META_FETCH_FAIL GET https://registry.npmjs.org/nextly: getaddrinfo ENOTFOUND",
      differing: ["nextly: 0.0.2-alpha.78 → 0.0.2-alpha.79"],
    }),
  // As `upgradeAction` ends a run for the database work the command used to do.
  UPGRADE_WORK_MOVED: () => upgradeWorkMoved(),
  // As `backupNotConfirmed` in `cli/commands/data-steps.ts` throws it with no terminal to ask.
  DATA_STEPS_BACKUP_NOT_CONFIRMED: () =>
    new NextlyError({
      code: "NEXTLY_UPGRADE_IN_PROGRESS",
      publicMessage:
        "`nextly migrate` would change data an earlier Nextly release stored (hash passwords stored before this release: 3), and does so only once a backup is confirmed. " +
        "Back up the database, then run `nextly migrate --backup-confirmed`.",
      logContext: {
        reason: "data-steps-backup-not-confirmed",
        command: "nextly migrate",
      },
    }),
  // As `backupDeclined` in the same module throws it for a "no" at the prompt.
  DATA_STEPS_BACKUP_DECLINED: () =>
    new NextlyError({
      code: "NEXTLY_UPGRADE_IN_PROGRESS",
      publicMessage:
        "The data an earlier Nextly release stored was left as it is (hash passwords stored before this release: 3): the backup question was answered no. " +
        "Back up the database, then run `nextly migrate` again and answer yes, or pass `--backup-confirmed`.",
      logContext: {
        reason: "data-steps-backup-declined",
        command: "nextly migrate",
      },
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
