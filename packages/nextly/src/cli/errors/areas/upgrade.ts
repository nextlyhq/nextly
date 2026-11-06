/**
 * Codes for `nextly upgrade` and its steps.
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
  UPGRADE_EVENTS_TABLE_TAKEN: {
    cause:
      "A table of another shape already has the name `nextly upgrade` moves the migration records into.",
    from: [
      {
        code: "NEXTLY_UPGRADE_TABLE_NAME_COLLISION",
        describe: error =>
          whatThenNext(
            error.publicMessage,
            `\`nextly upgrade\` moves the migration records into "${eventsTable(error)}", and the table there does not have the columns it writes. Nothing was changed.`
          ),
      },
    ],
  },
});
