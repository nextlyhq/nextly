/**
 * Codes for `nextly upgrade` and its steps, and for the move of an earlier
 * release's migration records, which `nextly migrate` makes.
 *
 * @module cli/errors/areas/upgrade
 */

import type { NextlyError } from "../../../errors/nextly-error";
import type { CliErrorParts } from "../cli-error";
import { defineCodes } from "../define";

/** The events table a refusal names, as the step recorded it. */
function eventsTable(error: NextlyError): string {
  const table = error.logContext?.table;
  return typeof table === "string" ? table : "nextly_schema_events";
}

/**
 * A refusal's first sentence as what happened and the rest as the next step, with the cause
 * between: the upgrade's refusals say what and next, and leave the cause to the reader.
 */
function whatThenNext(message: string, why: string): CliErrorParts {
  const end = message.indexOf(". ");
  if (end === -1) {
    return { what: message, why, next: "Run `nextly upgrade` again." };
  }
  return {
    what: message.slice(0, end + 1),
    why,
    next: message.slice(end + 2),
  };
}

export const UPGRADE_CODES = defineCodes({
  UPGRADE_CANCELLED: {
    cause:
      "The backup prompt of `nextly upgrade` was answered no, so the upgrade did not run.",
    retired: {
      why: "`nextly upgrade` no longer changes stored data: `nextly migrate` and `nextly i18n:convert-zoned-dates` do, and a no at their backup question ends them as `DATA_STEPS_BACKUP_DECLINED`.",
    },
  },
  UPGRADE_BACKUP_NOT_CONFIRMED: {
    cause:
      "`nextly upgrade` would change the database, and no backup was confirmed, with no terminal attached to ask.",
    retired: {
      why: "`nextly upgrade` no longer changes stored data: `nextly migrate` and `nextly i18n:convert-zoned-dates` do, and without a confirmed backup or a terminal they end as `DATA_STEPS_BACKUP_NOT_CONFIRMED`.",
    },
  },
  UPGRADE_WORK_MOVED: {
    cause:
      "`nextly upgrade` was run for the database work it used to do, which `nextly migrate` and `nextly i18n:convert-zoned-dates` now do, so it changed nothing.",
  },
  DATA_STEPS_BACKUP_NOT_CONFIRMED: {
    cause:
      "A command would change data an earlier Nextly release stored, and no backup was confirmed, with no terminal attached to ask.",
    from: [
      {
        code: "NEXTLY_UPGRADE_IN_PROGRESS",
        reason: "data-steps-backup-not-confirmed",
        describe: error =>
          whatThenNext(
            error.publicMessage,
            "No terminal is attached to ask whether the database is backed up, and `--backup-confirmed` was not passed. Nothing was changed."
          ),
      },
    ],
  },
  DATA_STEPS_BACKUP_DECLINED: {
    cause:
      "A command would change data an earlier Nextly release stored, and its backup question was answered no.",
    from: [
      {
        code: "NEXTLY_UPGRADE_IN_PROGRESS",
        reason: "data-steps-backup-declined",
        describe: error =>
          whatThenNext(
            error.publicMessage,
            "The command rewrites stored values in place, so it asks for a backup first, and the answer was no. Nothing was changed."
          ),
      },
    ],
  },
  MIGRATE_BACKUP_NOT_CONFIRMED: {
    cause:
      "`nextly migrate` found the migration records of an earlier Nextly release, and no backup was confirmed, with no terminal attached to ask.",
    from: [
      {
        code: "NEXTLY_UPGRADE_IN_PROGRESS",
        reason: "migrate-backup-not-confirmed",
        describe: error =>
          whatThenNext(
            error.publicMessage,
            "No terminal is attached to ask whether the database is backed up, and `--backup-confirmed` was not passed. Nothing was changed."
          ),
      },
    ],
  },
  MIGRATE_BACKUP_DECLINED: {
    cause:
      "`nextly migrate` found the migration records of an earlier Nextly release, and its backup question was answered no.",
    from: [
      {
        code: "NEXTLY_UPGRADE_IN_PROGRESS",
        reason: "migrate-backup-declined",
        describe: error =>
          whatThenNext(
            error.publicMessage,
            "`nextly migrate` moves those records into `nextly_schema_events` and drops the tables that held them, so it asks for a backup first, and the answer was no. Nothing was changed."
          ),
      },
    ],
  },
  MIGRATE_LEDGER_UNREADABLE: {
    cause:
      "`nextly migrate` found a `nextly_migrations` table of an earlier Nextly release holding records it cannot read, so it moved none of them.",
    from: [
      {
        code: "NEXTLY_UPGRADE_TABLE_NAME_COLLISION",
        reason: "migrate-ledger-unreadable",
        describe: error =>
          whatThenNext(
            error.publicMessage,
            "`nextly migrate` moves the records an earlier release kept in `nextly_migrations` into `nextly_schema_events`, and reads every one before writing any. One of them it cannot read, so nothing was changed."
          ),
      },
    ],
  },
  MIGRATE_EVENTS_TABLE_TAKEN: {
    cause:
      "A table of another shape already has the name `nextly migrate` moves the migration records of an earlier Nextly release into.",
    from: [
      {
        code: "NEXTLY_UPGRADE_TABLE_NAME_COLLISION",
        reason: "migrate-events-table-taken",
        describe: error =>
          whatThenNext(
            error.publicMessage,
            `\`nextly migrate\` moves the migration records of an earlier release into "${eventsTable(error)}", and the table there does not have the columns it writes. Nothing was changed.`
          ),
      },
    ],
  },
  UPGRADE_LEDGER_UNREADABLE: {
    cause:
      "`nextly upgrade` found a `nextly_migrations` table holding records it cannot read, so it moved none of them.",
    retired: {
      why: "`nextly upgrade` no longer moves the migration records of an earlier release: `nextly migrate` does, and a `nextly_migrations` table it cannot read ends it as `MIGRATE_LEDGER_UNREADABLE`.",
    },
  },
  UPGRADE_EVENTS_TABLE_TAKEN: {
    cause:
      "A table of another shape already has the name `nextly upgrade` moves the migration records into.",
    retired: {
      why: "`nextly upgrade` no longer moves the migration records of an earlier release: `nextly migrate` does, and a table of another shape under the events table's name ends it as `MIGRATE_EVENTS_TABLE_TAKEN`.",
    },
  },
});
