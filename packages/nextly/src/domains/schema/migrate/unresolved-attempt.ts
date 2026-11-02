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
 * section's. Whether it may have stopped part-way is the one predicate the
 * attempt was recorded by (`failedAttemptMayBePartial`): a file run in a
 * transaction on PostgreSQL or SQLite left nothing when it stopped, so it is
 * run again from its start, and is not refused here.
 *
 * @module domains/schema/migrate/unresolved-attempt
 */
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
  /**
   * How to recover this file's UP, where the file knows better than the
   * general advice: the one question that tells whether it landed, and the
   * step for each answer.
   */
  advice?: string;
}

type AttemptRow = Pick<
  SchemaEventRow,
  "eventType" | "status" | "startedAt" | "filename" | "supersededEventIds"
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
  outsideTransaction: boolean;
  statements: JudgedStatement[];
}

/**
 * Throws `NEXTLY_MIGRATION_PARTIALLY_APPLIED` naming every app file whose
 * newest unresolved attempt may have stopped part-way, each with its
 * statements judged from the live database. Reads only.
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
  for (const file of args.files) {
    const attempt = migrationStanding(
      byFilename.get(file.filename) ?? []
    ).unresolvedAttempt;
    if (attempt === undefined) continue;
    if (!failedAttemptMayBePartial(file, args.dialect)) continue;
    const direction = attempt.eventType === "file_rollback" ? "down" : "up";
    const statements = splitSqlStatements(
      direction === "up" ? file.upSql : file.downSql,
      args.dialect,
      file
    );
    refused.push({
      filename: file.filename,
      advice: file.advice,
      direction,
      failed: attempt.status === "failed",
      outsideTransaction: !file.transaction,
      statements: judgeStatements(
        statements,
        args.dialect,
        await args.readLive(statements)
      ),
    });
  }
  if (refused.length === 0) return;
  throw unresolvedAttemptError(args.command, refused);
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
  if (r.direction === "up") return r.advice ?? partiallyAppliedAdvice(f);
  return `If you finish ${f}'s down section by hand, record the rollback with \`nextly migrate:resolve --rolled-back ${f}\`; if you reverse the down section's statements that ran, record that with \`nextly migrate:resolve --failed-cleanup ${f}\`, and the migration stays applied.`;
}
