/**
 * Adopting a database that already exists.
 *
 * A project run with `db:sync` has tables but no snapshot, so the first
 * `migrate:create` diffs the config against nothing and emits `CREATE TABLE`
 * for every table already standing. That file cannot be applied: the live
 * database matches neither the empty baseline it assumes nor the target it
 * describes. Baselining records what the database already has, so the next
 * `migrate:create` emits a delta instead of a history.
 *
 * **Why this writes a migration file rather than only a marker.** Flyway's
 * `baseline` and Alembic's `stamp` record a version and no SQL, which works
 * because they assume nothing is ever rebuilt from below that point. Nextly
 * does not get to assume that: `migrate:fresh` rebuilds from the migration
 * history, and so does every new environment and CI run. A marker with no SQL
 * would leave a permanent hole under which the schema cannot be reconstructed.
 * Prisma's flow -- diff the live database into a real migration, then mark it
 * applied -- is the one that keeps "the migrations describe the schema" true,
 * so that is the shape here.
 *
 * **Why it is one command rather than Prisma's two.** Prisma spells this as
 * `migrate diff` followed by `migrate resolve --applied`, and forgetting the
 * second half leaves a migration that will be re-run against a database that
 * already has the tables. The two steps are never independently useful, so
 * they are one command and the recording is not something to remember.
 *
 * @module domains/schema/migrate/baseline
 */
import { NextlyError } from "../../../errors";
import { scopeLedgerRows } from "../events/ledger-scope";
import { standingsByFilename } from "../events/migration-state";
import type { SchemaEventRow } from "../events/schema-events-repository";
import { diffSnapshots } from "../pipeline/diff/diff";
import type { NextlySchemaSnapshot, Operation } from "../pipeline/diff/types";

/** The snapshot a first migration is diffed against when none exists. */
export const EMPTY_SNAPSHOT: NextlySchemaSnapshot = { tables: [] };

/** A ledger row as the baseline's history rules read it. */
export type LedgerRow = Pick<
  SchemaEventRow,
  "eventType" | "status" | "startedAt" | "filename" | "supersededEventIds"
>;

/** Each app migration's standing, a plugin's rows left to its own stream (`scopeLedgerRows`). */
function appStandings(rows: readonly LedgerRow[]) {
  return standingsByFilename(scopeLedgerRows(rows));
}

/**
 * The app migrations a baseline counts as history: those whose latest outcome
 * is applied, as every rule judges a migration's state (`migrationStanding`),
 * whatever records that are not outcomes follow it (an accepted checksum, a
 * removal recorded, an attempt). A migration rolled back is no history, file
 * present or not, and neither is a plugin's row.
 */
export function appliedAppMigrations(rows: readonly LedgerRow[]): string[] {
  return [...appStandings(rows)]
    .filter(([, standing]) => standing.state === "applied")
    .map(([filename]) => filename)
    .sort();
}

/** An app migration's attempt that failed or recorded no outcome, and nothing has resolved. */
export interface OpenAttempt {
  filename: string;
  /** The file's UP, or its down section. */
  direction: "up" | "down";
  /** False when the attempt recorded no outcome. */
  failed: boolean;
}

/** Every app migration with an unresolved attempt, by filename. */
export function openAttempts(rows: readonly LedgerRow[]): OpenAttempt[] {
  const open: OpenAttempt[] = [];
  for (const [filename, { unresolvedAttempt }] of appStandings(rows)) {
    if (unresolvedAttempt === undefined) continue;
    open.push({
      filename,
      direction:
        unresolvedAttempt.eventType === "file_rollback" ? "down" : "up",
      failed: unresolvedAttempt.status === "failed",
    });
  }
  return open.sort((a, b) => a.filename.localeCompare(b.filename));
}

/**
 * The refusal over an unresolved attempt the shared check let through
 * (`assertAppHistoryHolds`, which runs first): one it judged to have left
 * nothing, because it ran inside a transaction the database undoes whole.
 * A baseline still waits for it: it records the database as it stands as
 * applied history, which it cannot do while that history has an attempt no
 * one has said how it ended. An attempt that recorded no outcome may belong to
 * a run still going (a dry run takes no lock), so it is never said to be
 * undone, and is cleared only once no run is. Worded as the shared refusal is, so the CLI reads
 * it the same way (`unfinishedAttemptParts`): what stopped, why, ending "so it
 * is not run again.", then what to do.
 */
export function undoneAttemptRefusal(
  command: string,
  attempts: readonly OpenAttempt[]
): NextlyError {
  const names = attempts.map(a => a.filename);
  const [only] = attempts;
  const what =
    attempts.length === 1 && only !== undefined
      ? `${command} stops before changing anything: ${only.filename} has an unresolved attempt at its ${sectionOf(only)}.`
      : `${command} stops before changing anything: ${String(attempts.length)} migrations have an unresolved attempt (${names.join(", ")}).`;
  const why = attempts.map(undoneSentence).join(" ");
  const next = attempts.map(cleanupStep).join(" ");
  return new NextlyError({
    code: "NEXTLY_MIGRATION_PARTIALLY_APPLIED",
    publicMessage: `${what} ${why} A baseline records the database as it stands as applied history, so it waits until every attempt is recorded resolved; nothing is adopted or run, so it is not run again. ${next}`,
    logContext: {
      source: names.join(", "),
      reason: "partially-applied",
      attempts: attempts.map(a => ({ ...a })),
    },
  });
}

function sectionOf(attempt: OpenAttempt): string {
  return attempt.direction === "up" ? "UP" : "down section";
}

function undoneSentence(attempt: OpenAttempt): string {
  const at = `The attempt at ${attempt.filename}'s ${sectionOf(attempt)}`;
  return attempt.failed
    ? `${at} failed inside a transaction, which the database undoes whole, so none of it stayed.`
    : `${at} recorded no outcome: the process running it stopped, or is still running. It runs inside a transaction, so if it stopped, the database undid it whole and none of it stayed.`;
}

function cleanupStep(attempt: OpenAttempt): string {
  const step = `\`nextly migrate:resolve --failed-cleanup ${attempt.filename}\``;
  const when = attempt.failed
    ? "Record that"
    : "Once no run is in progress, record that";
  return attempt.direction === "up"
    ? `${when} with ${step}.`
    : `${when} with ${step}; the migration stays applied.`;
}

/** A migration a baseline counts as history, and where it is counted from. */
export interface HistoryMigration {
  filename: string;
  /** Its file is in the build's migrations folder. */
  inFolder: boolean;
  /** Its latest outcome in the ledger is applied (`appliedAppMigrations`). */
  applied: boolean;
}

/**
 * The lines a refused baseline prints over a history with no starting point:
 * each migration it counted, with the step that clears it. A migration the
 * ledger records applied is recorded rolled back, which runs nothing: its
 * tables stay, and the baseline adopts them. Never `migrate:down`, which
 * would drop them.
 */
export function historyRefusalLines(
  history: readonly HistoryMigration[]
): string[] {
  const width = Math.max(...history.map(m => m.filename.length));
  return [
    "This project already has migration history but no starting point, so a",
    "baseline would put a second origin after it. Nothing was written.",
    "",
    ...history.flatMap(m => clearingLines(m, width)),
    "",
    "If these migrations are this database's real history, don't baseline: keep",
    "their files in the folder, restoring any that are gone, and run",
    "`nextly migrate`. Otherwise clear each as shown and baseline again: it",
    "adopts the tables as they stand.",
  ];
}

function clearingLines(m: HistoryMigration, width: number): string[] {
  const name = `  ${m.filename.padEnd(width)}  `;
  const indent = " ".repeat(name.length);
  const record = `nextly migrate:resolve --rolled-back ${m.filename} --file-missing`;
  if (!m.applied) {
    return [
      `${name}in the migrations folder, not applied: move it out of the folder,`,
      `${indent}and after the baseline write what it does as a new migration`,
    ];
  }
  if (!m.inFolder) {
    return [`${name}recorded applied, its file gone: ${record}`];
  }
  return [
    `${name}in the migrations folder and recorded applied: move it out of the folder, then`,
    `${indent}${record}`,
  ];
}

/**
 * What a baseline run should do, decided before anything is written.
 *
 * Separated from the command so the refusals can be tested without a database:
 * each one is a judgement about two snapshots, and neither needs I/O to reach.
 */
export type BaselinePlan =
  | {
      /** A snapshot already exists, so the history has a starting point. */
      kind: "already-baselined";
      snapshotName: string;
    }
  | {
      /**
       * Migration files exist without a snapshot between them and an origin.
       *
       * A `--blank` migration carries hand-written SQL and no snapshot, so the
       * snapshot check alone reads such a project as never baselined. Appending
       * an origin AFTER those files means a fresh database replays them first,
       * against tables the baseline has not created yet.
       */
      kind: "history-not-empty";
      /** Every migration counted, by filename, each once. */
      history: HistoryMigration[];
    }
  | {
      /** No managed tables, so there is nothing to adopt. */
      kind: "empty-database";
    }
  | {
      kind: "baseline";
      /** The statements that would recreate the live schema from nothing. */
      operations: Operation[];
      /** Recorded as the starting point for every later diff. */
      snapshot: NextlySchemaSnapshot;
    };

export interface PlanBaselineArgs {
  /** The managed tables as they exist in the database right now. */
  live: NextlySchemaSnapshot;
  /**
   * The newest snapshot on disk, when the project has migrated before.
   *
   * Its presence is the whole test: a project with a snapshot already has a
   * starting point, and giving it a second one would put two different
   * origins in the same history.
   */
  latestSnapshotName?: string;
  /**
   * The migration `.sql` files already on disk.
   *
   * Checked separately from the snapshot because the two can disagree: a
   * `--blank` migration is written with no snapshot beside it, so a project
   * carrying only those has a real history and no starting point.
   */
  migrationFiles?: readonly string[];
  /**
   * The app migrations the ledger records as applied (`appliedAppMigrations`).
   *
   * Checked separately from the files because the two can disagree in the
   * damaging direction: a project whose migrations were deleted from disk
   * still has its applied rows, and the files alone read as no history at all.
   * Writing an origin there leaves the database with two, and the old rows
   * become applied migrations whose files are gone.
   */
  appliedMigrations?: readonly string[];
}

/** The files and the applied migrations as one list, by filename, each once. */
function historyOf(args: PlanBaselineArgs): HistoryMigration[] {
  const files = new Set(args.migrationFiles);
  const applied = new Set(args.appliedMigrations);
  return [...new Set([...files, ...applied])].sort().map(filename => ({
    filename,
    inFolder: files.has(filename),
    applied: applied.has(filename),
  }));
}

/**
 * Decide what baselining this database means.
 *
 * The live schema becomes the recorded starting point, and the operations that
 * would build it from nothing become the migration's body. That body is never
 * executed against this database -- it exists so a different one can be built
 * from the same history.
 */
export function planBaseline(args: PlanBaselineArgs): BaselinePlan {
  if (args.latestSnapshotName !== undefined) {
    return { kind: "already-baselined", snapshotName: args.latestSnapshotName };
  }

  // Ordered after the snapshot check so a normal project keeps the message
  // that names its origin, and before the empty check because a history with
  // files in it is a refusal whatever the database looks like.
  //
  // Disk and ledger are both asked, because either can carry the history on
  // its own: files without snapshots come from `--blank`, and applied rows
  // without files come from a project whose migrations were deleted.
  const history = historyOf(args);
  if (history.length > 0) {
    return { kind: "history-not-empty", history };
  }

  if (args.live.tables.length === 0) {
    return { kind: "empty-database" };
  }

  return {
    kind: "baseline",
    operations: diffSnapshots(EMPTY_SNAPSHOT, args.live),
    snapshot: args.live,
  };
}

/**
 * Whether a drift report is a database nobody has adopted yet.
 *
 * The signature is exact rather than approximate: the migration expected to
 * start from nothing, and every difference is a table the database already
 * has. Manual SQL and a half-finished run both leave differences in the other
 * direction as well, so neither reaches this.
 *
 * Worth separating from the message it produces, because the guidance is only
 * right if the detection is: telling someone to baseline a database whose real
 * problem is a failed migration would send them the wrong way.
 */
export function isUnadoptedDatabase(args: {
  /** The snapshot the migration expects to start from. */
  before: NextlySchemaSnapshot;
  /** How the live database differs from that snapshot. */
  driftKinds: readonly string[];
  /**
   * Whether this migration has been attempted before.
   *
   * A half-applied first migration looks identical from the schema alone. On
   * MySQL every DDL statement commits as it runs, so a first migration that
   * fails partway leaves its tables behind; the retry then starts from an
   * empty baseline and sees nothing but tables that already exist — the exact
   * signature below. The ledger is what separates the two, because a failed
   * attempt left a row and an unadopted database never has one.
   */
  hasPriorAttempt?: boolean;
}): boolean {
  if (args.hasPriorAttempt === true) return false;
  if (args.before.tables.length > 0) return false;
  if (args.driftKinds.length === 0) return false;
  return args.driftKinds.every(kind => kind === "+");
}
