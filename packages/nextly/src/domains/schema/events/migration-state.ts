/**
 * What the ledger says about one migration: its state, read from its latest
 * outcome alone, and whether it has an unresolved attempt.
 *
 * The ledger holds more than outcomes. A run records an attempt before it
 * runs a file (or its down section) and its outcome after; an attempt can
 * fail, stop with no outcome, or end knowing nothing of its file took effect;
 * a superseded row stays as history; and later records note things about a
 * file that are not about the database at all. Reading "the latest record of
 * any kind" let each of those change a migration's state: an applied
 * migration followed by any such record read as pending, and ran again.
 *
 * So both questions are answered here once, positively: only an outcome
 * changes a migration's state, and only an outcome, or an attempt that ended
 * with nothing applied, resolves an attempt. A record of any other kind,
 * including one added after this was written, changes neither.
 *
 * An app migration is judged by this rule. A plugin's module keeps the rule
 * its own history has always had, its newest record (`standingOf`), because a
 * plugin's history has rules of its own.
 *
 * @module domains/schema/events/migration-state
 */
import { isPluginLedgerRow } from "./ledger-scope";
import { newestEvent, newestFirst } from "./newest-event";
import type { SchemaEventRow } from "./schema-events-repository";

/** Where a migration stands, as its latest outcome says. */
export type MigrationState = "applied" | "rolled_back" | "pending";

type LedgerRecord = Pick<
  SchemaEventRow,
  "eventType" | "status" | "startedAt" | "filename" | "supersededEventIds"
>;

/**
 * Whether a ledger row is an attempt `migrate:resolve --failed-cleanup`
 * cleared: flipped to `rolled_back` in place, retiring nothing. A rollback
 * (`migrate:down`, `migrate:resolve --rolled-back`) is a row of its own that
 * retires the applied row it undoes, and dev push writes no row at all.
 *
 * The operator clears an attempt once they have finished its statements by
 * hand or reversed them, and where the database stands then says which: at
 * the unit's start it runs again, past it the operator has finished it.
 */
export function attemptCleared(
  row: Pick<SchemaEventRow, "status" | "supersededEventIds"> | undefined
): boolean {
  return (
    row?.status === "rolled_back" && (row.supersededEventIds ?? []).length === 0
  );
}

/**
 * Whether a record is an outcome: a run, `migrate:baseline` or
 * `migrate:resolve --applied` recording a migration applied, or
 * `migrate:down` or `migrate:resolve --rolled-back` recording it rolled back.
 * Every outcome is a `file_apply` row in one of those two statuses.
 *
 * A rollback retires the applied row it undoes. A `rolled_back` row that
 * retires nothing is a cleared attempt (`attemptCleared`), which resolves the
 * attempt but says nothing of the migration: read as a rollback, it made an
 * applied migration pending, and the next run applied it again on top of the
 * applied row the one-applied-row guard still sees.
 */
export function isOutcome(
  row: Pick<LedgerRecord, "eventType" | "status" | "supersededEventIds">
) {
  return (
    row.eventType === "file_apply" &&
    (row.status === "applied" ||
      (row.status === "rolled_back" && !attemptCleared(row)))
  );
}

/** Whether a record is an attempt at a file or its down section. */
function isAttemptRecord(row: Pick<LedgerRecord, "eventType">): boolean {
  return row.eventType === "file_apply" || row.eventType === "file_rollback";
}

/**
 * Whether a record is an attempt that did not finish: one that failed, or one
 * still `in_progress`, which recorded no outcome. Its process stopped (killed,
 * out of memory, its connection dropped), or is still running where no lock
 * holds it off. Either way a reader cannot know what of it ran.
 */
export function attemptUnfinished(
  row: Pick<SchemaEventRow, "status"> | undefined
): boolean {
  return row?.status === "failed" || row?.status === "in_progress";
}

/**
 * Whether a record resolves an older attempt: an outcome, an attempt cleared
 * by `migrate:resolve --failed-cleanup`, or an attempt that ended with
 * nothing applied.
 */
function resolvesAttempt(row: LedgerRecord): boolean {
  return (
    isOutcome(row) ||
    (row.eventType === "file_apply" && attemptCleared(row)) ||
    (isAttemptRecord(row) && row.status === "nothing_applied")
  );
}

/** One app migration's state, from its latest outcome alone. */
export function migrationState(rows: readonly LedgerRecord[]): MigrationState {
  return migrationStanding(rows).state;
}

function stateOf(outcome: LedgerRecord | undefined): MigrationState {
  if (outcome?.status === "applied") return "applied";
  if (outcome?.status === "rolled_back") return "rolled_back";
  return "pending";
}

/**
 * One migration's unresolved attempts, newest first: every attempt that did
 * not finish since the newest record that resolves one.
 *
 * Read newest first, an outcome or an attempt that ended with nothing applied
 * ends the list; an unfinished attempt joins it; any other record is passed
 * over, since it neither is an attempt nor resolves one.
 *
 * A plugin module (`key` is its qualified name) keeps its history's rule: the
 * unbroken run of unfinished records at its newest end, read from its
 * `file_apply` rows as every caller hands them.
 */
export function unresolvedAttempts<T extends LedgerRecord>(
  key: string,
  rows: readonly T[]
): T[] {
  if (isPluginLedgerRow(key)) {
    const ordered = newestFirst(rows);
    const firstOther = ordered.findIndex(row => !attemptUnfinished(row));
    return firstOther === -1 ? ordered : ordered.slice(0, firstOther);
  }
  const attempts: T[] = [];
  for (const row of newestFirst(rows)) {
    if (resolvesAttempt(row)) break;
    if (isAttemptRecord(row) && attemptUnfinished(row)) attempts.push(row);
  }
  return attempts;
}

/**
 * Whether an app migration has an unresolved attempt: its latest attempt
 * failed or recorded no outcome, and no outcome has been recorded since.
 */
export function hasUnresolvedAttempt(rows: readonly LedgerRecord[]): boolean {
  return migrationStanding(rows).unresolvedAttempt !== undefined;
}

/** Where a migration stands, with the records that say so. */
export interface MigrationStanding<T extends LedgerRecord = SchemaEventRow> {
  state: MigrationState;
  /** The record the state was read from; absent while pending. */
  outcome: T | undefined;
  /** The newest unresolved attempt, if there is one. */
  unresolvedAttempt: T | undefined;
}

/** An app migration's standing, from every ledger row recorded for it. */
export function migrationStanding<T extends LedgerRecord>(
  rows: readonly T[]
): MigrationStanding<T> {
  const outcome = newestEvent(rows.filter(isOutcome));
  return {
    state: stateOf(outcome),
    outcome,
    unresolvedAttempt: unresolvedAttempts("", rows)[0],
  };
}

/**
 * A migration's standing under the rule its ledger key falls under: an app
 * migration's (`migrationStanding`), or for a plugin module its newest
 * record, read from its `file_apply` rows as every caller hands them, as its
 * history has always been read.
 */
export function standingOf<T extends LedgerRecord>(
  key: string,
  rows: readonly T[]
): MigrationStanding<T> {
  if (!isPluginLedgerRow(key)) return migrationStanding(rows);
  const newest = newestEvent(rows);
  return {
    state: stateOf(newest),
    outcome: newest !== undefined && isOutcome(newest) ? newest : undefined,
    unresolvedAttempt: unresolvedAttempts(key, rows)[0],
  };
}

/**
 * Each migration's standing in a ledger read, by ledger key, under the rule
 * its key falls under (`standingOf`). Rows with no filename are skipped.
 */
export function standingsByFilename<T extends LedgerRecord>(
  rows: readonly T[]
): Map<string, MigrationStanding<T>> {
  const byFilename = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.filename) continue;
    const list = byFilename.get(row.filename);
    if (list) list.push(row);
    else byFilename.set(row.filename, [row]);
  }
  const standings = new Map<string, MigrationStanding<T>>();
  for (const [filename, list] of byFilename) {
    standings.set(filename, standingOf(filename, list));
  }
  return standings;
}
