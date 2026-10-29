/**
 * Codes for migration runs: the schema lock, the data-loss consent, the migration files, the
 * ledger `migrate:resolve` repairs, and the checks `migrate:check` makes.
 *
 * @module cli/errors/areas/migrations
 */

import type { DataLossVerdict } from "../../../domains/schema/migrate/data-loss-consent";
import { NextlyError } from "../../../errors/nextly-error";
import { builderMigrationRemedy } from "../../utils/migration-discovery";
import { CliError, type CliErrorParts } from "../cli-error";
import { defineCodes } from "../define";
import { deepestMessage } from "../messages";

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

/** `message` cut after its first sentence: that sentence, and the rest ("" when there is none). */
function splitFirst(message: string): [string, string] {
  const end = message.indexOf(". ");
  return end === -1
    ? [message, ""]
    : [message.slice(0, end + 1), message.slice(end + 2)];
}

/** A clause cut out of a sentence, as a sentence of its own. */
function sentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return trimmed;
  const capital = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

/** The error `error` wraps, when it wraps one of Nextly's own. */
function wrapped(error: NextlyError): NextlyError | undefined {
  return NextlyError.is(error.cause) ? error.cause : undefined;
}

/** Whether `error` is, or directly wraps, an error with this code and `logContext.reason`. */
function wraps(error: NextlyError, code: string, reason: string): boolean {
  const inner = wrapped(error);
  return inner?.code === code && inner.logContext?.reason === reason;
}

/** The line every failure no narrower code reads ends with. */
const RUN_AGAIN =
  "Fix the cause the Why line names, then run the command again; `--verbose` shows where it failed.";

/**
 * The refusal of a command whose lock was released before its work ran: "The migrate lock was
 * released without …. Nothing was written; retry once no other schema operation is running."
 */
function lockReleasedParts(error: NextlyError): CliErrorParts {
  const [what, rest] = splitFirst(error.publicMessage);
  const semi = rest.indexOf("; ");
  if (semi === -1) {
    return {
      what,
      why:
        rest || "The schema lock was released before the command's work ran.",
      next: "Run the command again once no other schema operation is running.",
    };
  }
  return {
    what,
    why: sentence(rest.slice(0, semi)),
    next: sentence(rest.slice(semi + 2)),
  };
}

/**
 * Builder-written files with no snapshot, in `builderMigrationRemedy`'s words: what each is and
 * why it is not applied, then the migration to commit in its place.
 */
function builderSnapshotParts(
  what: string,
  files: readonly string[]
): CliErrorParts {
  const why: string[] = [];
  const next: string[] = [];
  for (const file of files) {
    const remedy = builderMigrationRemedy(file);
    const at = remedy.indexOf(" Replace it with ");
    why.push(at === -1 ? remedy : remedy.slice(0, at));
    if (at !== -1) next.push(remedy.slice(at + 1));
  }
  return {
    what,
    why: why.join("\n"),
    next:
      next.join("\n") ||
      "Replace each file with the migration `nextly migrate:create` writes for its change.",
  };
}

/** The files a refusal of Builder-written files names, from its context. */
function refusedFiles(error: NextlyError): string[] {
  const files = error.logContext?.files;
  return Array.isArray(files)
    ? files.filter((file): file is string => typeof file === "string")
    : [];
}

/**
 * A drift refusal, as `migrationDriftError` lays it out: a header, the migration and its file,
 * the cause, the drift summary, the recovery, and a link. The cause and the summary are why; the
 * recovery, with its commands as printed, is next; the link gives way to the Docs line.
 */
function driftParts(error: NextlyError): CliErrorParts {
  const lines = error.publicMessage.split("\n");
  const migration = error.logContext?.migration;
  const what =
    typeof migration === "string"
      ? `Migration \`${migration}\` cannot be applied: schema drift detected.`
      : sentence(lines[0] ?? error.publicMessage);
  // The paragraph starting at `from`, up to the next blank line.
  const paragraph = (from: number): string[] => {
    const end = lines.indexOf("", from);
    return lines.slice(from, end === -1 ? undefined : end);
  };
  const fileAt = lines.findIndex(line => line.startsWith("  File:"));
  const summaryAt = lines.findIndex(line => line.startsWith("  Drift summary"));
  const detailsAt = lines.findIndex(line => line.startsWith("  Details:"));
  if (fileAt === -1 || summaryAt === -1) {
    return { what, why: error.publicMessage, next: RUN_AGAIN };
  }
  const cause = paragraph(fileAt + 2)
    .map(line => line.trim())
    .join(" ");
  const summary = paragraph(summaryAt)
    .map((line, i) => (i === 0 ? line.trim() : `  ${line.trim()}`))
    .filter(line => line.trim().length > 0);
  const recoveryFrom = summaryAt + summary.length + 1;
  // The blank lines between its steps are left out: the Next line indents every line it holds,
  // and a blank one would print as trailing spaces.
  const recovery = lines
    .slice(recoveryFrom, detailsAt === -1 ? undefined : detailsAt)
    .filter(line => line.trim().length > 0)
    .map(line => line.replace(/^ {2}/, ""));
  // The message's own "Details:" link is left out: the Docs line names this code's page.
  return {
    what,
    why: [cause, ...summary].join("\n"),
    next: recovery.join("\n"),
  };
}

/**
 * Another run recorded the unit first: "Another run recorded X applied while this one was running
 * it.", then what happened to this run's statements, with what to check when they may have stayed.
 */
function concurrentRunParts(error: NextlyError): CliErrorParts {
  const [what, rest] = splitFirst(error.publicMessage);
  const at = rest.indexOf(": check what ");
  if (at !== -1) {
    return {
      what,
      why: sentence(rest.slice(0, at)),
      next: sentence(rest.slice(at + 2)),
    };
  }
  return {
    what,
    why: rest,
    next: "Run `nextly migrate:status` to see what the other run recorded; nothing of this run is left to undo.",
  };
}

/** How `assertNotPartiallyApplied` ends the sentence that says what it refuses. */
const UNFINISHED_REFUSAL_ENDS = [
  "so it is not recorded as applied without running.",
  "so it is not run again.",
];

/**
 * A unit whose last attempt may have stopped part-way: the attempt, what is refused because of
 * it, then the recovery.
 */
function unfinishedAttemptParts(error: NextlyError): CliErrorParts {
  const message = error.publicMessage;
  for (const end of UNFINISHED_REFUSAL_ENDS) {
    const at = message.indexOf(end);
    if (at === -1) continue;
    const [what, why] = splitFirst(message.slice(0, at + end.length));
    const next = message.slice(at + end.length).trim();
    return {
      what,
      why,
      next:
        next ||
        "Finish its remaining statements by hand and mark it applied with `nextly migrate:resolve --applied`, or reverse them and run `nextly migrate:resolve --failed-cleanup`.",
    };
  }
  const [what, rest] = splitFirst(message);
  return {
    what,
    why: rest || "Its last attempt may have stopped part-way.",
    next: "Finish its remaining statements by hand and mark it applied with `nextly migrate:resolve --applied`, or reverse them and run `nextly migrate:resolve --failed-cleanup`.",
  };
}

/**
 * A unit run outside a transaction whose statement failed: which one, the database's reason (kept
 * out of the public message and carried as its cause), what stayed applied, and the recovery.
 */
function partialRunParts(error: NextlyError): CliErrorParts {
  const [what, kept] = splitFirst(error.publicMessage);
  const [stayed, advice] = splitFirst(kept);
  const reason = deepestMessage(error.cause);
  return {
    what,
    why: [reason ?? "", stayed].filter(line => line.length > 0).join("\n"),
    next: advice || RUN_AGAIN,
  };
}

/**
 * A unit that left rows referencing rows that do not exist: rolled back whole inside a
 * transaction, or left applied outside one, with the repair the message names.
 */
function danglingReferenceParts(error: NextlyError): CliErrorParts {
  const message = error.publicMessage;
  const [what, rest] = splitFirst(message);
  const marker = "stayed applied: ";
  const at = rest.indexOf(marker);
  if (at !== -1) {
    return {
      what,
      why: sentence(rest.slice(0, at + marker.length - 2)),
      next: sentence(rest.slice(at + marker.length)),
    };
  }
  return {
    what,
    why: rest || "Each row it names references a row that does not exist.",
    next: "Remove or repair the rows it leaves without a parent, in the migration or before it runs, then run it again.",
  };
}

/** SQLite's enforcement left on, because another transaction held the connection. */
function enforcementOnParts(error: NextlyError): CliErrorParts {
  const message = error.publicMessage;
  const because = message.indexOf(", because ");
  const semi = message.lastIndexOf("; ");
  if (because === -1 || semi === -1 || semi < because) {
    return {
      what: message,
      why: "Another transaction was open on the connection.",
      next: "Run it again once that transaction has finished.",
    };
  }
  const [cause, nothing] = splitFirst(message.slice(because + 10, semi));
  return {
    what: `${message.slice(0, because)}.`,
    why: [sentence(cause), sentence(nothing)].filter(Boolean).join(" "),
    next: sentence(message.slice(semi + 2)),
  };
}

/** The reasons a core reconcile's refusal lists, one per line. */
function coreReasons(list: string): string {
  return list
    .split("; ")
    .map(reason => reason.trim())
    .filter(reason => reason.length > 0)
    .join("\n");
}

/**
 * A strict core reconcile's refusal: "Core schema reconciliation requires destructive operations:
 * <reasons>. This usually means a Nextly version mismatch. Set NEXTLY_ALLOW_CORE_DESTRUCTIVE=1 to
 * proceed (see release notes)."
 */
function coreRefusedParts(error: NextlyError): CliErrorParts {
  const message = error.publicMessage;
  const head = "Core schema reconciliation requires destructive operations: ";
  const usually = message.lastIndexOf(". This usually means");
  const set = message.lastIndexOf(" Set NEXTLY_ALLOW_CORE_DESTRUCTIVE");
  if (!message.startsWith(head) || usually === -1 || set < usually) {
    return {
      what: message,
      why: "A destructive change to Nextly's own tables is refused without consent.",
      next: "Set NEXTLY_ALLOW_CORE_DESTRUCTIVE=1 to proceed (see release notes).",
    };
  }
  return {
    what: "Core schema reconciliation requires destructive operations.",
    why: `${coreReasons(message.slice(head.length, usually))}\n${message.slice(usually + 2, set)}`,
    next: message.slice(set + 1),
  };
}

/** A confirmed core reconcile the operator declined: the destructive changes it named. */
function coreDeclinedParts(error: NextlyError): CliErrorParts {
  const message = error.publicMessage;
  const head =
    "Core schema reconciliation aborted: destructive operations were not confirmed: ";
  return {
    what: "Core schema reconciliation aborted: destructive operations were not confirmed.",
    why: message.startsWith(head)
      ? coreReasons(message.slice(head.length).replace(/\.$/, ""))
      : message,
    next: "Run `nextly upgrade --reconcile-core` again and confirm each change once you have checked its data is not needed.",
  };
}

/** A migration the database refused, or a Builder save's schema change it refused. */
function applyFailedParts(error: NextlyError): CliErrorParts {
  const message = error.publicMessage;
  const reason = deepestMessage(error.cause);
  const named = /^Migration (\S+) failed: ([\s\S]*)$/.exec(message);
  if (named !== null) {
    return {
      what: `Migration \`${named[1]}\` failed.`,
      why: reason ?? named[2],
      next: RUN_AGAIN,
    };
  }
  const [what, rest] = splitFirst(message);
  return {
    what,
    why:
      [reason, rest]
        .filter(line => line !== undefined && line !== "")
        .join("\n") || "The database gave no reason.",
    next: RUN_AGAIN,
  };
}

/** Whether the precondition refusal is the one this message starts with or holds. */
const precondition =
  (test: (message: string) => boolean) => (error: NextlyError) =>
    test(error.publicMessage);

/**
 * A consent the parser could not read, in its own words: what it is, then how to write one, then
 * "Nothing was changed." as the reason it is safe to run again.
 */
function malformedConsentParts(message: string): CliErrorParts {
  const sentences = message.split(/(?<=\.) (?=[A-Z])/);
  const what = sentences[0] ?? message;
  const nothing = sentences.find(
    sentence => sentence === "Nothing was changed."
  );
  const next = sentences
    .slice(1)
    .filter(sentence => sentence !== nothing)
    .join(" ");
  return {
    what,
    why: `Each target is a table or a \`table.column\` pair, separated by commas. ${nothing ?? ""}`.trim(),
    next:
      next.length > 0
        ? next
        : "Name the tables and columns it covers, or give `--accept-data-loss` alone.",
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
      // A full plugin uninstall's refusal is the same verdict, with the `--keep-data` way out.
      {
        code: "PLUGIN_UNINSTALL_UNCONFIRMED",
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
      // A full plugin uninstall's refusal is the same verdict, with the `--keep-data` way out.
      {
        code: "PLUGIN_UNINSTALL_UNCONFIRMED",
        reason: "data-loss-not-covered",
        describe: error => dataLossParts(error.publicMessage),
      },
    ],
  },
  DATA_LOSS_CONSENT_MALFORMED: {
    cause:
      "The data-loss consent names its targets in a form it cannot read, so the command changed nothing.",
    from: [
      {
        // The consent's parser gives no reason, so its two refusals are known by their opening.
        code: "INVALID_INPUT",
        when: error =>
          /^(--accept-data-loss|NEXTLY_ACCEPT_DATA_LOSS)=.*? (is not a list of tables|names nothing)/.test(
            error.publicMessage
          ),
        describe: error => malformedConsentParts(error.publicMessage),
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
  BASELINE_LOCK_RELEASED: {
    cause:
      "The schema lock was released before `nextly migrate:baseline` adopted the database, so nothing was written.",
    from: [
      { code: "NEXTLY_BASELINE_LOCK_NOT_HELD", describe: lockReleasedParts },
    ],
  },
  RESOLVE_LOCK_RELEASED: {
    cause:
      "The schema lock was released before `nextly migrate:resolve` changed the migration's record, so nothing was written.",
    from: [
      { code: "NEXTLY_RESOLVE_LOCK_NOT_HELD", describe: lockReleasedParts },
    ],
  },
  BUILDER_MIGRATION_SNAPSHOT_MISSING: {
    cause:
      "A migration file the Schema Builder wrote has no snapshot beside it, so `nextly migrate` does not apply it.",
    from: [
      {
        code: "NEXTLY_MIGRATION_SNAPSHOT_MISSING",
        when: error => refusedFiles(error).length > 0,
        describe: error =>
          builderSnapshotParts(
            splitFirst(error.publicMessage)[0],
            refusedFiles(error)
          ),
      },
    ],
  },
  RESOLVE_SNAPSHOT_MISSING: {
    cause:
      "`nextly migrate:resolve --applied` has no snapshot to compare the live schema with.",
    from: [
      {
        code: "NEXTLY_MIGRATION_SNAPSHOT_MISSING",
        describe: error => {
          const [what, rest] = splitFirst(error.publicMessage);
          return {
            what,
            why: "`--applied` records a file once the live schema matches the snapshot `migrate:create` wrote beside it in `meta/`, and this file has none.",
            next:
              rest ||
              "Re-run with `--skip-verify` to record it without the comparison.",
          };
        },
      },
    ],
  },
  RESOLVE_FILE_NOT_FOUND: {
    cause:
      "The migration file named to `nextly migrate:resolve` is not in the migrations folder.",
    from: [
      {
        code: "NEXTLY_MIGRATION_FILE_MISSING",
        describe: error => ({
          what: sentence(error.publicMessage),
          why: "`nextly migrate:resolve` records a file of the project's migrations folder (`db.migrationsDir`), and none has this name.",
          next: "Check the name with `nextly migrate:status`, and pass it as listed there, with or without `.sql`.",
        }),
      },
    ],
  },
  RESOLVE_PLUGIN_MODULE: {
    cause:
      "`nextly migrate:resolve --applied` was given a plugin module, which `nextly migrate` records itself.",
    from: [
      {
        code: "NEXTLY_MIGRATION_RESOLVE_PRECONDITION",
        when: precondition(message => message.includes(" is a plugin module")),
        describe: error => {
          const [why, next] = splitFirst(error.publicMessage);
          const module = why.slice(0, why.indexOf(" is a plugin module"));
          return {
            what: `\`nextly migrate:resolve --applied\` does not mark \`${module}\` applied.`,
            why,
            next,
          };
        },
      },
    ],
  },
  RESOLVE_NOT_APPLIED: {
    cause:
      "`nextly migrate:resolve --rolled-back` was given a migration with no applied run to roll back.",
    from: [
      {
        code: "NEXTLY_MIGRATION_RESOLVE_PRECONDITION",
        when: precondition(message => message.startsWith("Cannot roll back ")),
        describe: error => ({
          what: error.publicMessage,
          why: "`--rolled-back` records that an applied migration was undone, and the ledger holds no applied run of this file.",
          next: "Run `nextly migrate:status` to see the file's state: a file that never ran needs no rollback recorded.",
        }),
      },
    ],
  },
  RESOLVE_NOTHING_TO_CLEAN_UP: {
    cause:
      "`nextly migrate:resolve --failed-cleanup` was given a migration with no failed or unfinished attempt.",
    from: [
      {
        code: "NEXTLY_MIGRATION_RESOLVE_PRECONDITION",
        when: precondition(message =>
          message.startsWith("No failed or unfinished attempt")
        ),
        describe: error => {
          const [what, rest] = splitFirst(error.publicMessage);
          return {
            what: what.replace(/;[^;]*$/, "."),
            why:
              rest ||
              "`--failed-cleanup` clears the attempts that failed or recorded no outcome, and this file has none.",
            next: "Run `nextly migrate:status` to see the file's state; to run it again, use `nextly migrate`.",
          };
        },
      },
    ],
  },
  RESOLVE_SCHEMA_MISMATCH: {
    cause:
      "`nextly migrate:resolve --applied` found the live schema does not match the migration's snapshot.",
    from: [
      {
        code: "NEXTLY_MIGRATION_RESOLVE_DRIFT",
        describe: error => {
          const [what, rest] = splitFirst(error.publicMessage);
          return {
            what,
            why: "`--applied` records a file only once the database stands where the file leaves it, and some table or column differs from its snapshot.",
            next: rest || "Resolve the drift or re-run with --skip-verify.",
          };
        },
      },
    ],
  },
  RESOLVE_MODE_REQUIRED: {
    cause:
      "`nextly migrate:resolve` was given none, or more than one, of `--applied`, `--rolled-back` and `--failed-cleanup`.",
  },
  LEGACY_BOOKKEEPING_FOUND: {
    cause:
      "The database still has the migration bookkeeping tables of an earlier Nextly release.",
    from: [
      {
        code: "NEXTLY_LEGACY_BOOKKEEPING_DETECTED",
        describe: error => {
          const [what, next] = splitFirst(error.publicMessage);
          return {
            what,
            why: "They hold the history an earlier release recorded, which this release keeps in `nextly_schema_events`.",
            next: next || "Run `pnpm nextly upgrade` once to consolidate them.",
          };
        },
      },
    ],
  },
  CORE_DESTRUCTIVE_CHANGE_REFUSED: {
    cause:
      "Bringing Nextly's own tables up to date needs a destructive change, which `nextly migrate` makes only with `NEXTLY_ALLOW_CORE_DESTRUCTIVE=1`.",
    from: [
      { code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED", describe: coreRefusedParts },
    ],
  },
  CORE_DESTRUCTIVE_CHANGE_DECLINED: {
    cause:
      "A destructive change to Nextly's own tables was not confirmed at the prompt, so none was made.",
    from: [
      {
        code: "NEXTLY_CORE_DESTRUCTIVE_REFUSED",
        when: precondition(message =>
          message.startsWith("Core schema reconciliation aborted")
        ),
        describe: coreDeclinedParts,
      },
    ],
  },
  CORE_SCHEMA_APPLY_FAILED: {
    cause: "The database refused a change to Nextly's own tables.",
    from: [
      {
        code: "NEXTLY_MIGRATION_APPLY_FAILED",
        when: precondition(message =>
          message.startsWith("Core schema apply failed: ")
        ),
        describe: error => ({
          what: "Core schema apply failed.",
          why: error.publicMessage.slice("Core schema apply failed: ".length),
          next: RUN_AGAIN,
        }),
      },
    ],
  },
  MIGRATION_APPLY_FAILED: {
    cause:
      "The database refused a statement of a migration or of a schema change.",
    from: [
      { code: "NEXTLY_MIGRATION_APPLY_FAILED", describe: applyFailedParts },
    ],
  },
  MIGRATION_DRIFT: {
    cause:
      "The database matches neither the state a migration starts from nor the state it produces.",
    from: [{ code: "NEXTLY_MIGRATION_DRIFT", describe: driftParts }],
  },
  DATABASE_NOT_BASELINED: {
    cause:
      "The database already has tables but no migration history, and the first migration starts from an empty database.",
    from: [
      {
        code: "NEXTLY_MIGRATION_DRIFT",
        when: error => error.logContext?.unadoptedDatabase === true,
        describe: driftParts,
      },
    ],
  },
  MIGRATION_CONCURRENT_RUN: {
    cause:
      "Another run recorded the same migration while this one was running it.",
    from: [
      { code: "NEXTLY_MIGRATION_CONCURRENT_RUN", describe: concurrentRunParts },
    ],
  },
  MIGRATION_ATTEMPT_UNFINISHED: {
    cause:
      "A migration's last attempt may have stopped part-way, so it is neither run again nor recorded as applied.",
    from: [
      {
        code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
        reason: "partially-applied",
        describe: unfinishedAttemptParts,
      },
      {
        code: "NEXTLY_MIGRATION_APPLY_FAILED",
        when: error =>
          wraps(
            error,
            "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
            "partially-applied"
          ) && wrapped(error)?.logContext?.failedStatement === undefined,
        describe: error => unfinishedAttemptParts(wrapped(error) ?? error),
      },
    ],
  },
  MIGRATION_PARTIALLY_APPLIED: {
    cause:
      "A migration run outside a transaction failed part-way, and the statements before the failing one stayed applied.",
    from: [
      {
        code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
        reason: "partially-applied",
        when: error => error.logContext?.failedStatement !== undefined,
        describe: partialRunParts,
      },
      {
        code: "NEXTLY_MIGRATION_APPLY_FAILED",
        when: error =>
          wraps(
            error,
            "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
            "partially-applied"
          ) && wrapped(error)?.logContext?.failedStatement !== undefined,
        describe: error => partialRunParts(wrapped(error) ?? error),
      },
    ],
  },
  MIGRATION_FOREIGN_KEY_VIOLATION: {
    cause:
      "A migration would leave rows that reference rows that do not exist.",
    from: [
      {
        code: "NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION",
        reason: "dangling-reference",
        describe: danglingReferenceParts,
      },
      {
        code: "NEXTLY_MIGRATION_APPLY_FAILED",
        when: error =>
          wraps(
            error,
            "NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION",
            "dangling-reference"
          ),
        describe: error => danglingReferenceParts(wrapped(error) ?? error),
      },
    ],
  },
  SQLITE_FOREIGN_KEYS_STILL_ON: {
    cause:
      "SQLite's foreign-key enforcement could not be switched off for a migration, because another transaction was open on the connection.",
    from: [
      {
        code: "NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION",
        reason: "enforcement-still-on",
        describe: enforcementOnParts,
      },
      {
        code: "NEXTLY_MIGRATION_APPLY_FAILED",
        when: error =>
          wraps(
            error,
            "NEXTLY_MIGRATION_FOREIGN_KEY_VIOLATION",
            "enforcement-still-on"
          ),
        describe: error => enforcementOnParts(wrapped(error) ?? error),
      },
    ],
  },
  MIGRATION_IRREVERSIBLE: {
    cause: "A migration to roll back has no `-- DOWN` section.",
    from: [
      {
        code: "INVALID_INPUT",
        reason: "down-sql-missing",
        describe: error => {
          const [what, next] = splitFirst(error.publicMessage);
          return {
            what,
            why: "`nextly migrate:down` runs a migration's `-- DOWN` section, and this file's is empty.",
            next,
          };
        },
      },
    ],
  },
  PRODUCTION_ROLLBACK_UNCONFIRMED: {
    cause:
      "`nextly migrate:down` was run with `NODE_ENV=production` and without `--yes`.",
    from: [
      {
        code: "INVALID_INPUT",
        reason: "production-needs-yes",
        describe: error => {
          const [what, rest] = splitFirst(error.publicMessage);
          const rerun = rest.lastIndexOf("Re-run with");
          return {
            what,
            why: `\`NODE_ENV\` is \`production\`. ${rerun === -1 ? rest : rest.slice(0, rerun).trim()}`,
            next:
              rerun === -1
                ? "Re-run with --yes to override."
                : rest.slice(rerun),
          };
        },
      },
    ],
  },
  MIGRATION_FILE_EDITED: {
    cause:
      "A migration file no longer matches the checksum `migrate:create` recorded in its snapshot.",
  },
  MIGRATION_SNAPSHOT_MISSING: {
    cause: "A migration file has no snapshot file beside it in `meta/`.",
  },
  MIGRATION_SNAPSHOT_INVALID: {
    cause:
      "A migration's snapshot file is not valid JSON, or not a snapshot this version of Nextly reads.",
  },
  SNAPSHOT_WITHOUT_MIGRATION: {
    cause: "A snapshot file in `meta/` has no migration file beside it.",
  },
  SCHEMA_CHANGE_WITHOUT_MIGRATION: {
    cause:
      "The configuration has schema changes that no migration file holds yet.",
  },
  SETTINGS_CHANGE_WITHOUT_MIGRATION: {
    cause:
      "An entity's settings changed in the configuration, and no migration records the change.",
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

/** `nextly migrate:resolve` was given none, or more than one, of its three modes. */
export function resolveModeRequired(given: number): CliError {
  return new CliError("RESOLVE_MODE_REQUIRED", {
    what: "`nextly migrate:resolve` needs exactly one thing to record.",
    why:
      given === 0
        ? "It was given none of `--applied`, `--rolled-back` and `--failed-cleanup`."
        : `It was given ${given} of \`--applied\`, \`--rolled-back\` and \`--failed-cleanup\`.`,
    next: "Provide exactly one of --applied, --rolled-back, or --failed-cleanup.",
  });
}

/** Builder-written files with no snapshot, as the command that found them reports them. */
export function builderSnapshotMissing(
  what: string,
  files: readonly string[]
): CliError {
  return new CliError(
    "BUILDER_MIGRATION_SNAPSHOT_MISSING",
    builderSnapshotParts(what, files)
  );
}

/** A migration file whose content differs from the hash its snapshot recorded. */
export function migrationFileEdited(
  sqlName: string,
  expected: string | undefined,
  actual: string
): CliError {
  return new CliError("MIGRATION_FILE_EDITED", {
    what: `The migration file \`${sqlName}\` was edited after generation.`,
    why: `Expected SHA-256: ${expected ?? "none recorded"}\nActual SHA-256:   ${actual}`,
    next: 'Either revert the edit, or delete this file and re-generate via `nextly migrate:create --name="<migration-name>"`.',
  });
}

/** A migration file with no snapshot beside it, not written by the Schema Builder. */
export function migrationSnapshotMissing(
  sqlName: string,
  metaDir: string
): CliError {
  return new CliError("MIGRATION_SNAPSHOT_MISSING", {
    what: `\`${sqlName}\` has no paired snapshot file in ${metaDir}.`,
    why: `Nothing is at \`${sqlName.replace(/\.sql$/, "")}.snapshot.json\`, which \`migrate:create\` writes beside every migration; a migration generated before it wrote snapshots has none.`,
    next: "Either delete it, or re-create it with `nextly migrate:create --blank` and copy the SQL across.",
  });
}

/** A snapshot file that could not be read, in `SnapshotFileError`'s words. */
export function migrationSnapshotInvalid(message: string): CliError {
  const read = /^snapshot file (.+?) is invalid: ([\s\S]*)$/.exec(message);
  return new CliError("MIGRATION_SNAPSHOT_INVALID", {
    what:
      read === null
        ? "A snapshot file is invalid."
        : `The snapshot file \`${read[1]}\` is invalid.`,
    why: read === null ? message : read[2],
    next: "Restore it from version control; if a newer version of Nextly wrote it, upgrade `nextly` to that version.",
  });
}

/** A snapshot whose migration file is gone. */
export function snapshotWithoutMigration(
  snapName: string,
  baseName: string
): CliError {
  return new CliError("SNAPSHOT_WITHOUT_MIGRATION", {
    what: `The snapshot \`${snapName}\` exists but \`${baseName}.sql\` does not.`,
    why: "A snapshot is written beside the migration it describes, and this one's migration was deleted or never committed.",
    next: "Restore the .sql file from version control, or delete the orphan snapshot.",
  });
}

/** The command that records a pending change: the remedy both drift checks give. */
const CREATE_MIGRATION =
  'Run `nextly migrate:create --name="<migration-name>"` and commit the result.';

/** Schema changes no migration holds, each as a line of the drift list. */
export function schemaChangeWithoutMigration(
  count: number,
  lines: readonly string[]
): CliError {
  return new CliError("SCHEMA_CHANGE_WITHOUT_MIGRATION", {
    what: `${count} pending schema change(s) detected.`,
    why: lines.join("\n"),
    next: CREATE_MIGRATION,
  });
}

/** Settings changes no migration records, each as a line of the drift list. */
export function settingsChangeWithoutMigration(
  count: number,
  lines: readonly string[]
): CliError {
  return new CliError("SETTINGS_CHANGE_WITHOUT_MIGRATION", {
    what: `${count} entit${count === 1 ? "y's" : "ies'"} settings changed with no migration.`,
    why: lines.join("\n"),
    next: CREATE_MIGRATION,
  });
}
