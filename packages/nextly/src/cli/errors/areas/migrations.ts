/**
 * Codes for migration runs: the schema lock, the data-loss consent, and the migration files.
 *
 * @module cli/errors/areas/migrations
 */

import type { DataLossVerdict } from "../../../domains/schema/migrate/data-loss-consent";
import type { NextlyError } from "../../../errors/nextly-error";
import { CliError, type CliErrorParts } from "../cli-error";
import { defineCodes } from "../define";

/**
 * The lock's refusal, as its three parts.
 *
 * The refusal already says all three, in order: what did not happen ("`nextly migrate` did not
 * start, and changed nothing: the schema lock is still held."), who holds it, and "Run it again
 * once that finishes." Split rather than reworded, so the CLI and the boot log keep one wording.
 */
function lockRefusal(error: NextlyError): CliErrorParts {
  const message = error.publicMessage;
  const end = message.indexOf(". ");
  const nextAt = message.lastIndexOf(" Run it again");
  if (end === -1 || nextAt <= end) {
    return {
      what: message,
      why: "Another run holds the schema lock.",
      next: "Run it again once that run finishes.",
    };
  }
  return {
    what: message.slice(0, end + 1),
    why: message.slice(end + 2, nextAt),
    next: message.slice(nextAt + 1),
  };
}

/**
 * A data-loss refusal, as its three parts, in the consent's own wording.
 *
 * The verdict's message is a header ("Deleting data needs consent, and no terminal is attached to
 * ask. This would delete:"), the deletions one per line, then "Nothing was changed. To consent:
 * …". The header's first sentence is what happened, the list and "Nothing was changed." are why,
 * and the consent to give is next.
 */
function dataLossParts(message: string): CliErrorParts {
  const lines = message.split("\n");
  const header = lines[0] ?? message;
  const last = lines.length > 1 ? lines[lines.length - 1] : "";
  // The deletions, one per line; their indent is the message's, and the Why line has its own.
  const list = lines.slice(1, -1).map(line => line.trimStart());
  const marker = /\s(To consent|To delete this too): /.exec(last);
  const headerEnd = header.indexOf(". ");
  const what =
    headerEnd === -1
      ? header.replace(/:$/, ".")
      : header.slice(0, headerEnd + 1);
  const rest = headerEnd === -1 ? [] : [header.slice(headerEnd + 2)];
  if (marker === null) {
    return {
      what,
      why: [...rest, ...list, last].filter(Boolean).join("\n"),
      next: "Give the data-loss consent for each deletion listed, or run it where a terminal can ask.",
    };
  }
  return {
    what,
    why: [...rest, ...list, last.slice(0, marker.index)].join("\n"),
    next: last.slice(marker.index + 1),
  };
}

export const MIGRATION_CODES = defineCodes({
  SCHEMA_LOCK_HELD: {
    cause:
      "Another run holds the schema lock, so the command did not start and changed nothing.",
    from: [{ code: "NEXTLY_MIGRATE_LOCK_BUSY", describe: lockRefusal }],
  },
  DATA_LOSS_CONSENT_REQUIRED: {
    cause:
      "The command would delete data, no consent covers it, and no terminal is attached to ask.",
    from: [
      {
        code: "INVALID_INPUT",
        reason: "data-loss-needs-consent",
        describe: error => dataLossParts(error.publicMessage),
      },
    ],
  },
  DATA_LOSS_CONSENT_NOT_COVERED: {
    cause:
      "The data-loss consent names what may be deleted, and leaves out something the command would delete.",
    from: [
      {
        code: "INVALID_INPUT",
        reason: "data-loss-not-covered",
        describe: error => dataLossParts(error.publicMessage),
      },
    ],
  },
  MIGRATION_TAMPERED: {
    cause:
      "A migration recorded as applied has a file that no longer matches its recorded checksum.",
  },
  MIGRATION_MISSING: {
    cause:
      "A migration recorded as applied has no file in the migrations folder.",
  },
});

/** A refused data-loss verdict as the command's error, under the code for its reason. */
export function dataLossRefusal(
  verdict: Extract<DataLossVerdict, { kind: "refused" }>
): CliError {
  return new CliError(
    verdict.reason === "needs-consent"
      ? "DATA_LOSS_CONSENT_REQUIRED"
      : "DATA_LOSS_CONSENT_NOT_COVERED",
    {
      ...dataLossParts(verdict.message),
      context: { reason: `data-loss-${verdict.reason}` },
    }
  );
}
