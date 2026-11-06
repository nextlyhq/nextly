/**
 * The refusal every command that runs or rolls back app migrations makes
 * before its first write, while an app migration has an unresolved attempt
 * that may have stopped part-way.
 *
 * On MySQL, and in a file marked to run outside a transaction, each schema
 * statement commits as it runs, so a run that stopped or failed inside a file
 * (or inside its down section) can have left some of its statements applied.
 * The ledger cannot say which: a ledger write never commits together with
 * such a statement. So the command stops, names the file, and judges each of
 * its statements from the live database as it stands now
 * (`judgeStatements`), never from the ledger. The operator finishes the file
 * by hand or reverses what ran, and records which with `migrate:resolve`.
 *
 * Whether an attempt is unresolved is the ledger's one rule
 * (`migrationStanding`), read over both the file's attempts and its down
 * section's. Whether it may have stopped part-way is read from what the
 * ledger recorded of the attempt (`attemptMayBePartial`), never from the
 * file as edited since: a file that ran in a transaction on PostgreSQL or
 * SQLite left nothing when it stopped, so it is run again from its start,
 * and is not refused here.
 *
 * @module domains/schema/migrate/unresolved-attempt
 */
import {
  NO_TRANSACTION_ROLLBACK_NOTE,
  PARTIAL_ROLLBACK_NOTE,
} from "../../../cli/commands/plugin-module-rollback";
import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors";
import { isPluginLedgerRow } from "../events/ledger-scope";
import { migrationStanding } from "../events/migration-state";
import type { SchemaEventRow } from "../events/schema-events-repository";

import { failedAttemptMayBePartial } from "./drift-reconcile";
import { partiallyAppliedAdvice } from "./migration-transaction";
import { splitSqlStatements } from "./split-sql";
import {
  judgeStatements,
  type JudgedStatement,
  type LiveSchema,
  type UnknownReason,
} from "./statement-judgement";

/** An app migration file as the refusal reads it. */
export interface AttemptedFile {
  /** The ledger's name for it: `<name>.sql`. */
  filename: string;
  upSql: string;
  downSql: string;
  /** False for a file marked to run outside a transaction. */
  transaction: boolean;
  /** SHA-256 of the file's whole text, as a run records it on its attempt. */
  checksum: string;
  /**
   * How to recover this file's UP, where the file knows better than the
   * general advice: the one question that tells whether it landed, and the
   * step for each answer.
   */
  advice?: string;
}

type AttemptRow = Pick<
  SchemaEventRow,
  | "eventType"
  | "status"
  | "startedAt"
  | "filename"
  | "supersededEventIds"
  | "sha256"
  | "note"
>;

export interface RefuseUnresolvedAttemptsArgs {
  /** Every app migration file in the build's folder. */
  files: readonly AttemptedFile[];
  /** The ledger's `file_apply` and `file_rollback` rows; plugin rows are passed over. */
  rows: readonly AttemptRow[];
  dialect: SupportedDialect;
  /** Reads the live schema the statements are judged against (`readLiveSchema`). */
  readLive: (statements: readonly string[]) => Promise<LiveSchema>;
  /** The command refusing, as the operator typed it. */
  command: string;
}

/** One refused file: which section's attempt, how it ended, and its statements as judged. */
interface Refused {
  filename: string;
  advice: string | undefined;
  direction: "up" | "down";
  failed: boolean;
  /**
   * What can be said of the statements: `judged` from the live database;
   * `missing`, the build lacks the file; `changed`, the file is not the text
   * the attempt ran, so today's statements are not the ones to judge.
   */
  basis: "judged" | "missing" | "changed";
  /** Where a judged attempt ran: outside a transaction, or on MySQL. */
  outsideTransaction: boolean;
  statements: JudgedStatement[];
}

/**
 * Whether an unresolved attempt may have stopped part-way, from what the
 * ledger recorded of it rather than from the file as it is now, which may
 * have been edited since (its no-transaction marker removed, say).
 *
 * - An UP's attempt records the checksum of the file's whole text, its marker
 *   line included. Where it matches the file today, the file ran as it reads
 *   now, and the one predicate the attempt was recorded by decides
 *   (`failedAttemptMayBePartial`). Where it differs or is missing, how the
 *   attempt ran cannot be shown, so it is taken as possibly partial.
 * - A down section's attempt is recorded before its first statement only
 *   where it may stop part-way, so one with no outcome may have; a failed one
 *   says in its note when it ran outside a transaction or on MySQL.
 */
function attemptMayBePartial(
  attempt: AttemptRow,
  file: AttemptedFile,
  dialect: SupportedDialect
): boolean {
  if (attempt.eventType === "file_rollback") {
    if (dialect === "mysql" || attempt.status === "in_progress") return true;
    const note = attempt.note ?? "";
    return (
      note.startsWith(PARTIAL_ROLLBACK_NOTE) ||
      note.startsWith(NO_TRANSACTION_ROLLBACK_NOTE)
    );
  }
  if (attempt.sha256 !== file.checksum) return true;
  return failedAttemptMayBePartial(file, dialect);
}

/**
 * Whether the file today is the text the attempt ran: an UP's attempt records
 * its checksum; a down section's ran the file as recorded applied.
 */
function sameTextAsAttempt(
  attempt: AttemptRow,
  outcome: AttemptRow | undefined,
  file: AttemptedFile
): boolean {
  const recorded =
    attempt.eventType === "file_rollback" ? outcome?.sha256 : attempt.sha256;
  return recorded === file.checksum;
}

/**
 * Throws `NEXTLY_MIGRATION_PARTIALLY_APPLIED` naming every app file whose
 * newest unresolved attempt may have stopped part-way, each with its
 * statements judged from the live database. Reads only.
 *
 * An unresolved attempt at a file this build's folder lacks (removed,
 * renamed, or written by a newer build) is refused on every dialect: without
 * the file, the build cannot tell whether that attempt ran in a transaction,
 * nor judge its statements.
 */
export async function refuseUnresolvedAttempts(
  args: RefuseUnresolvedAttemptsArgs
): Promise<void> {
  const byFilename = new Map<string, AttemptRow[]>();
  for (const row of args.rows) {
    if (row.filename === null || isPluginLedgerRow(row.filename)) continue;
    const list = byFilename.get(row.filename);
    if (list) list.push(row);
    else byFilename.set(row.filename, [row]);
  }
  const refused: Refused[] = [];
  const inFolder = new Set(args.files.map(file => file.filename));
  for (const file of args.files) {
    const standing = migrationStanding(byFilename.get(file.filename) ?? []);
    const attempt = standing.unresolvedAttempt;
    if (attempt === undefined) continue;
    if (!attemptMayBePartial(attempt, file, args.dialect)) continue;
    const direction = attempt.eventType === "file_rollback" ? "down" : "up";
    const refusal = {
      filename: file.filename,
      advice: file.advice,
      direction,
      failed: attempt.status === "failed",
      outsideTransaction: !file.transaction,
    } as const;
    if (!sameTextAsAttempt(attempt, standing.outcome, file)) {
      refused.push({ ...refusal, basis: "changed", statements: [] });
      continue;
    }
    const statements = splitSqlStatements(
      direction === "up" ? file.upSql : file.downSql,
      args.dialect,
      file
    );
    refused.push({
      ...refusal,
      basis: "judged",
      statements: judgeStatements(
        statements,
        args.dialect,
        await readLiveOrNothing(args, statements)
      ),
    });
  }
  for (const [filename, rows] of byFilename) {
    if (inFolder.has(filename)) continue;
    const attempt = migrationStanding(rows).unresolvedAttempt;
    if (attempt === undefined) continue;
    refused.push({
      filename,
      advice: undefined,
      direction: attempt.eventType === "file_rollback" ? "down" : "up",
      failed: attempt.status === "failed",
      outsideTransaction: false,
      basis: "missing",
      statements: [],
    });
  }
  if (refused.length === 0) return;
  throw unresolvedAttemptError(args.command, refused);
}

/**
 * The live schema, or undefined when it could not be read: the refusal still
 * names the file and says what to do, with every statement unknown, rather
 * than ending on the read's own error, which names neither.
 */
async function readLiveOrNothing(
  args: Pick<RefuseUnresolvedAttemptsArgs, "readLive">,
  statements: readonly string[]
): Promise<LiveSchema | undefined> {
  try {
    return await args.readLive(statements);
  } catch {
    return undefined;
  }
}

/**
 * The refusal, worded so the CLI reads it as an unfinished attempt: what
 * stopped, then why (the attempt and its statements), ending "so it is not
 * run again.", then what to do.
 */
function unresolvedAttemptError(
  command: string,
  refused: readonly Refused[]
): NextlyError {
  const names = refused.map(r => r.filename);
  const [only] = refused;
  const what =
    refused.length === 1 && only !== undefined
      ? `${command} stops before changing anything: ${only.filename} has an unresolved attempt at its ${sectionOf(only)}.`
      : `${command} stops before changing anything: ${String(refused.length)} migrations have an unresolved attempt (${names.join(", ")}).`;
  const why = refused.map(attemptSentence).join(" ");
  return new NextlyError({
    code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
    publicMessage: `${what} ${why} Until the attempt is recorded resolved, nothing is run or rolled back, so it is not run again. ${refused.map(adviceFor).join(" ")}`,
    logContext: {
      source: names.join(", "),
      reason: "partially-applied",
      attempts: refused.map(r => ({
        filename: r.filename,
        direction: r.direction,
        ...(r.basis === "judged" ? {} : { [r.basis]: true }),
        statements: r.statements.map(s => ({
          number: s.number,
          verdict: s.verdict,
          ...(s.reason === undefined ? {} : { reason: s.reason }),
        })),
      })),
    },
  });
}

function sectionOf(r: Refused): string {
  return r.direction === "up" ? "UP" : "down section";
}

/** How one refused attempt ended and where, then each statement's verdict. */
function attemptSentence(r: Refused): string {
  const ended = r.failed
    ? "failed"
    : "recorded no outcome (the process running it stopped, or is still running)";
  if (r.basis === "missing") {
    return `The attempt at ${r.filename}'s ${sectionOf(r)} ${ended}, and this build lacks ${r.filename}, so it cannot tell how that attempt ran or judge its statements: the database may hold part of it.`;
  }
  if (r.basis === "changed") {
    return `The attempt at ${r.filename}'s ${sectionOf(r)} ${ended}, and ${r.filename} has changed since that attempt ran, so this build cannot tell how it ran or judge the statements it ran: the database may hold part of it.`;
  }
  const where = r.outsideTransaction
    ? "outside a transaction, as the file is marked to run"
    : "on MySQL, which commits each schema statement as it runs";
  const judged =
    r.statements.length === 0
      ? "It holds no statement to judge."
      : `Judged from the database as it stands now, not from the ledger: ${r.statements.map(verdictPhrase).join("; ")}.`;
  return `The attempt at ${r.filename}'s ${sectionOf(r)} ${ended}, and it ran ${where}, so part of it may have stayed applied. ${judged}`;
}

const UNKNOWN_BECAUSE: Record<UnknownReason, string> = {
  rows: "it reads or writes rows, which the schema does not show",
  unread: "the database cannot show whether it ran",
  undone: "a later statement of the file changes what it made",
  conditional: "it may have found the schema already so",
  mixed: "the database shows only part of its effect",
  no_table: "the table it changes is not there",
};

function verdictPhrase(s: JudgedStatement): string {
  const head = `statement ${String(s.number)} (${s.label})`;
  if (s.verdict === "done") return `${head} is done`;
  if (s.verdict === "not_done") return `${head} is not done`;
  return `${head} is unknown, because ${UNKNOWN_BECAUSE[s.reason ?? "unread"]}`;
}

/**
 * What the operator does about one refused attempt. An UP finished by hand is
 * recorded applied; one reversed by hand has its attempt cleared and runs
 * again (`partiallyAppliedAdvice`, or the file's own). A down section
 * finished by hand is recorded rolled back; one reversed by hand has its
 * attempt cleared, and the migration stays applied.
 */
function adviceFor(r: Refused): string {
  const f = r.filename;
  // Recording a file applied or rolled back reads the file; clearing an
  // attempt does not.
  if (r.basis === "missing") {
    return `Run the build that has ${f}, or restore it here, to finish or record it; if you reverse what of it ran, record that with \`nextly migrate:resolve --failed-cleanup ${f}\`.`;
  }
  if (r.direction === "up") return r.advice ?? partiallyAppliedAdvice(f);
  return `If you finish ${f}'s down section by hand, record the rollback with \`nextly migrate:resolve --rolled-back ${f}\`; if you reverse the down section's statements that ran, record that with \`nextly migrate:resolve --failed-cleanup ${f}\`, and the migration stays applied.`;
}
