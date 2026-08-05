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
import { diffSnapshots } from "../pipeline/diff/diff";
import type { NextlySchemaSnapshot, Operation } from "../pipeline/diff/types";

/** The snapshot a first migration is diffed against when none exists. */
export const EMPTY_SNAPSHOT: NextlySchemaSnapshot = { tables: [] };

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
      filename: string;
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
   * Any migration `.sql` already on disk, when the project has one.
   *
   * Checked separately from the snapshot because the two can disagree: a
   * `--blank` migration is written with no snapshot beside it, so a project
   * carrying only those has a real history and no starting point.
   */
  existingMigrationFile?: string;
  /**
   * A filename the ledger already records as applied, when it has one.
   *
   * Checked separately from the files because the two can disagree in the
   * damaging direction: a project whose migrations were deleted from disk
   * still has its applied rows, and the files alone read as no history at all.
   * Writing an origin there leaves the database with two, and the old rows
   * become applied migrations whose files are gone.
   */
  appliedMigration?: string;
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
  const existing = args.existingMigrationFile ?? args.appliedMigration;
  if (existing !== undefined) {
    return { kind: "history-not-empty", filename: existing };
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
