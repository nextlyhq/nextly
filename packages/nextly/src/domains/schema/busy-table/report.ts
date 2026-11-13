/**
 * What an operator reads about a schema change that waited for a table another database session
 * is using: who holds it, the one line printed at each try after the first, and the error a change
 * ends with once its tries stop.
 *
 * Every line names the holder only by what `HolderReport` carries (a session's id, user, address,
 * application and how long its transaction has been open), never the text of a query it runs: that
 * text can hold another session's data. The error's log context is rebuilt from those fields
 * alone, so a value handed along with more than the types name does not reach a log either.
 *
 * @module domains/schema/busy-table/report
 */
import { NextlyError } from "../../../errors/nextly-error";

import type { NoRetryReason } from "./judge";
import type {
  BusyTableOutcome,
  BusyTableStop,
  HolderReport,
  HolderSession,
} from "./types";

/** A span of whole seconds as an operator reads it: "45 s", "3 min", "2 h". */
function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${String(s)} s`;
  if (s < 3600) return `${String(Math.floor(s / 60))} min`;
  return `${String(Math.floor(s / 3600))} h`;
}

/** Milliseconds as rounded seconds: "90 s". */
function roundedSeconds(ms: number): string {
  return `${String(Math.max(0, Math.round(ms / 1000)))} s`;
}

/** `text` ending with one full stop. */
function sentence(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

/** One session, with each detail the database gave and none it did not. */
function describeSession(session: HolderSession): string {
  const details: string[] = [];
  if (session.user !== null) details.push(`user ${session.user}`);
  if (session.clientAddress !== null) {
    details.push(`from ${session.clientAddress}`);
  }
  if (session.applicationName !== null) {
    details.push(`application ${JSON.stringify(session.applicationName)}`);
  }
  if (session.transactionOpenSeconds !== null) {
    details.push(
      `transaction open ${duration(session.transactionOpenSeconds)}`
    );
  }
  return details.length === 0
    ? `session ${session.id}`
    : `session ${session.id} (${details.join(", ")})`;
}

/**
 * What holds a table, for an operator: each session the database names, then each detail that
 * could not be read, with why; or, where the database names no holder (SQLite), why it cannot.
 */
export function describeTableHolder(report: HolderReport): string {
  if (report.kind === "unnamed") return report.reason;
  const sessions =
    report.sessions.length === 0
      ? "a session the database did not name"
      : report.sessions.map(describeSession).join(", ");
  return [sessions, ...report.unreadable.map(line => `not read: ${line}`)].join(
    "; "
  );
}

/** "table "posts"", or "a table" where the database names none. */
function tableName(table: string | null): string {
  return table === null ? "a table" : `table ${JSON.stringify(table)}`;
}

/** "held by session 4242 (…)", or why the holder is not named. */
function heldBy(holder: HolderReport): string {
  return holder.kind === "named"
    ? `held by ${describeTableHolder(holder)}`
    : `and its holder is not named: ${describeTableHolder(holder)}`;
}

/**
 * The line printed to standard error at each try after the first: the change, the table it waits
 * for, what holds it, and which try this is of the most the bounds allow; with when it starts,
 * where the caller says.
 */
export function tryNotice(input: {
  change: string;
  table: string | null;
  holder: HolderReport;
  tryNumber: number;
  plannedTries: number;
  nextInMs?: number;
}): string {
  const starting =
    input.nextInMs === undefined
      ? ""
      : `, starting in ${roundedSeconds(input.nextInMs)}`;
  return (
    `${input.change}: ${tableName(input.table)} is busy, ${heldBy(input.holder)}; ` +
    `try ${String(input.tryNumber)} of up to ${String(input.plannedTries)}${starting}.`
  );
}

/** Each kind of statement that may not be sent again, as the report names it. */
const NO_RETRY_KINDS: Record<NoRetryReason, string> = {
  setval: "a `setval`, whose sequence position a rollback does not undo,",
  "concurrent-index":
    "an index built or dropped without blocking writes, which an ended try can leave invalid,",
  "unknown-code": "a call of code the system does not know",
  trigger:
    "a row change on a table with a trigger, which runs code the system does not know,",
  "outside-write": "a write outside the database's own transaction",
  unread: "a statement of a kind the system does not recognise",
};

/** The first line: the change, how it stopped, and why. */
function whatHappened(stop: BusyTableStop, why: string): string {
  const change = `\`${stop.change}\``;
  switch (stop.outcome.kind) {
    case "nothing-changed":
      return `${change} stopped: ${why}, nothing changed.`;
    case "part-way":
      return `${change} stopped part-way: ${why}.`;
    case "no-retry":
      // The statement that may not be sent again was not; earlier tries, counted on the next
      // line, may have run other statements again before it.
      return `${change} stopped without trying again: ${why}.`;
  }
}

/** "Statement 2", or "Statements 1, 2 and 4", of the change. */
function statementsNamed(numbers: readonly number[]): string {
  const listed = numbers.map(String);
  if (listed.length === 1) return `Statement ${listed[0]}`;
  return `Statements ${listed.slice(0, -1).join(", ")} and ${listed[listed.length - 1]}`;
}

/** What the outcome left: the committed statements, or the statement that was not tried again. */
function outcomeLines(outcome: BusyTableOutcome): string[] {
  switch (outcome.kind) {
    case "nothing-changed":
      return [];
    case "part-way":
      // Named by position, never by text: a statement can hold a literal value.
      return [
        `${statementsNamed(outcome.committed)} had committed before the wait, and stay.`,
      ];
    case "no-retry":
      return [
        `It was not tried again, since its statement ${String(outcome.statementNumber)}, ` +
          `${NO_RETRY_KINDS[outcome.reason]}, may not be sent again. ` +
          (outcome.restUndone
            ? "The rest of the change was undone with its transaction."
            : "What ran before it was not undone."),
      ];
  }
}

/** The table waited for, the tries and their time, and what holds it. */
function waitLine(stop: BusyTableStop): string {
  const tries = stop.tries === 1 ? "1 try" : `${String(stop.tries)} tries`;
  const waited = `It waited for ${tableName(stop.ended.table)} through ${tries} over ${roundedSeconds(stop.elapsedMs)}`;
  return stop.ended.holder.kind === "named"
    ? sentence(`${waited}, held by ${describeTableHolder(stop.ended.holder)}`)
    : sentence(
        `${waited}; its holder is not named: ${describeTableHolder(stop.ended.holder)}`
      );
}

/** The changes this run applied before the one that stopped. */
function appliedLine(appliedBefore: readonly string[]): string {
  return appliedBefore.length === 0
    ? "Nothing was applied before it in this run."
    : `Applied before it in this run: ${appliedBefore.map(change => `\`${change}\``).join(", ")}.`;
}

/** What to do next: wait out or end the holder, or resolve a file that stopped part-way. */
function nextStep(stop: BusyTableStop): string {
  if (stop.outcome.kind === "nothing-changed") {
    return (
      "Run it again once the holder ends, end the holding session, or raise `--lock-timeout` / " +
      "`--lock-timeout-total` (or `NEXTLY_LOCK_TIMEOUT` / `NEXTLY_LOCK_TIMEOUT_TOTAL`)."
    );
  }
  // Stopped with no retry, in a transaction that rolled back whole: nothing of the file stayed but
  // what the statement itself keeps (a sequence's position), and the file applies from its start.
  if (stop.outcome.kind === "no-retry" && stop.outcome.restUndone) {
    return (
      `Run it again once the holder ends or the holding session is ended: \`${stop.change}\` ` +
      "was undone whole and applies from its start. Check what the statement named above keeps " +
      "(for `setval`, the sequence's position) before it runs again. If the command refuses " +
      "the file for an unresolved attempt, clear it first with " +
      `\`nextly migrate:resolve --failed-cleanup ${stop.change}\`.`
    );
  }
  return (
    `Resolve \`${stop.change}\` with \`nextly migrate:resolve\` as for any part-way file: finish ` +
    "its remaining statements by hand and mark it applied with `nextly migrate:resolve --applied`, " +
    "or reverse them and run `nextly migrate:resolve --failed-cleanup`."
  );
}

/** `report` with only the fields its type names: a session's details, never more. */
function plainHolder(report: HolderReport): HolderReport {
  if (report.kind === "unnamed") {
    return { kind: "unnamed", reason: report.reason };
  }
  return {
    kind: "named",
    sessions: report.sessions.map(session => ({
      id: session.id,
      user: session.user,
      clientAddress: session.clientAddress,
      applicationName: session.applicationName,
      transactionOpenSeconds: session.transactionOpenSeconds,
    })),
    unreadable: [...report.unreadable],
  };
}

/** `outcome` with only the fields its type names. */
function plainOutcome(outcome: BusyTableOutcome): BusyTableOutcome {
  switch (outcome.kind) {
    case "nothing-changed":
      return { kind: "nothing-changed" };
    case "part-way":
      return { kind: "part-way", committed: [...outcome.committed] };
    case "no-retry":
      return {
        kind: "no-retry",
        statementNumber: outcome.statementNumber,
        reason: outcome.reason,
        restUndone: outcome.restUndone,
      };
  }
}

/**
 * `stop` rebuilt from the fields its type names, for the log: a value handed along with more (a
 * holder's query text read by a careless caller) loses what the types do not carry.
 */
function plainStop(stop: BusyTableStop): BusyTableStop {
  return {
    change: stop.change,
    ended: { table: stop.ended.table, holder: plainHolder(stop.ended.holder) },
    tries: stop.tries,
    elapsedMs: stop.elapsedMs,
    appliedBefore: [...stop.appliedBefore],
    outcome: plainOutcome(stop.outcome),
    cause: stop.cause,
    endedAtLease: stop.endedAtLease,
  };
}

/**
 * The error a change ends with once its tries for a busy table stop: `NEXTLY_TABLE_BUSY`, its
 * reason "table busy", and the stop in its log context.
 *
 * The public message is one line saying what happened, then the lines saying why (what the
 * outcome left, the wait, the changes applied before it, and on SQLite why the tries ended early),
 * then one line saying what to do next, so a reader can split it into those three parts.
 */
export function tableBusyError(stop: BusyTableStop): NextlyError {
  const why = "table busy";
  const lines = [
    whatHappened(stop, why),
    ...outcomeLines(stop.outcome),
    waitLine(stop),
    appliedLine(stop.appliedBefore),
    ...(stop.endedAtLease
      ? [
          "The tries ended early: the schema lock could not be renewed while another connection " +
            "holds the whole database.",
        ]
      : []),
    nextStep(stop),
  ];
  return new NextlyError({
    code: "NEXTLY_TABLE_BUSY",
    publicMessage: lines.join("\n"),
    logContext: { reason: why, stop: plainStop(stop) },
  });
}

/**
 * Whether `error` is a busy-table stop that left nothing of its change: one whose attempt ends
 * with nothing applied, recorded as no failure.
 */
export function busyTableLeftNothing(error: unknown): boolean {
  if (!NextlyError.is(error) || error.code !== "NEXTLY_TABLE_BUSY")
    return false;
  const stop = (
    error.logContext as { stop?: { outcome?: { kind?: unknown } } } | undefined
  )?.stop;
  return stop?.outcome?.kind === "nothing-changed";
}
