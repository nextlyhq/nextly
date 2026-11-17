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
    from: [
      {
        code: "NEXTLY_UPGRADE_IN_PROGRESS",
        reason: "cancelled",
        describe: error => ({
          what: error.publicMessage,
          why: "The upgrade asks for a backup before its first step that changes anything, and the answer was no. Nothing was changed.",
          next: "Back up the database, then run `nextly upgrade` again and answer yes.",
        }),
      },
    ],
  },
  UPGRADE_BACKUP_NOT_CONFIRMED: {
    cause:
      "`nextly upgrade` would change the database, and no backup was confirmed, with no terminal attached to ask.",
    from: [
      {
        code: "NEXTLY_UPGRADE_IN_PROGRESS",
        reason: "backup-not-confirmed",
        describe: error =>
          whatThenNext(
            error.publicMessage,
            "No terminal is attached to ask whether the database is backed up, and `--confirm-backed-up` was not passed. Nothing was changed."
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
  UPGRADE_LEDGER_UNREADABLE: {
    cause:
      "A `nextly_migrations` table holds records Nextly cannot read, so none of them was moved.",
    from: [
      {
        code: "NEXTLY_UPGRADE_TABLE_NAME_COLLISION",
        reason: "legacy-ledger-unreadable",
        describe: error =>
          whatThenNext(
            error.publicMessage,
            "`nextly migrate` moves the records an earlier release kept in `nextly_migrations` into `nextly_schema_events`, and reads every one before writing any. One of them it cannot read, so nothing was changed."
          ),
      },
    ],
  },
  UPGRADE_EVENTS_TABLE_TAKEN: {
    cause:
      "A table of another shape already has the name the migration records of an earlier release are moved into.",
    from: [
      {
        code: "NEXTLY_UPGRADE_TABLE_NAME_COLLISION",
        describe: error =>
          whatThenNext(
            error.publicMessage,
            `\`nextly migrate\` moves the migration records of an earlier release into "${eventsTable(error)}", and the table there does not have the columns it writes. Nothing was changed.`
          ),
      },
    ],
  },
});
