/**
 * `nextly migrate:resolve` — operator recovery.
 *
 * Flips `file_apply` bookkeeping without (re-)running SQL, for three
 * recovery situations:
 *   --applied        record a file as applied (live must equal the file's
 *                    target snapshot, unless --skip-verify, or the file has
 *                    none and is marked `-- nextly:no-transaction`, or the
 *                    database is MySQL and its newest attempt failed);
 *                    supersede the prior failed rows, and record the file's
 *                    checksum. On a file already applied, accept its edit:
 *                    record its new checksum on the applied row. An app file
 *                    only: a plugin module is recorded by `nextly migrate`,
 *                    after --failed-cleanup.
 *   --rolled-back    record a rolled_back event so the next `migrate` re-runs
 *                    the file (requires a prior applied row). With
 *                    --file-missing, said explicitly, for a file the folder
 *                    no longer holds: it also retires an attempt a newer
 *                    build left unfinished, recording the migration rolled
 *                    back.
 *   --removed        record that an applied migration's file was removed
 *                    from the folder on purpose: it stays applied, and the
 *                    missing-file check no longer counts it.
 *   --failed-cleanup flip the stuck attempts (every failed or unfinished one
 *                    since the file's last other event, its down section's
 *                    included) to rolled_back so the .sql can be edited
 *                    before the next attempt (no new row).
 *
 * Effects (repo, fs existence, snapshot load, live introspection) are injected
 * so the state machine unit-tests against the in-memory SQLite fixture without
 * a CLI shell. Two snapshots are equivalent when their diff is empty.
 *
 * @module domains/schema/migrate/resolve
 * @since v0.0.3-alpha
 */
import type { SupportedDialect } from "../../../database/schema-registry";
import { NextlyError } from "../../../errors";
import { isPluginLedgerRow, ledgerFilename } from "../events/ledger-scope";
import {
  attemptCleared,
  migrationStanding,
  removedOnPurpose,
  standingOf,
  unresolvedAttempts,
} from "../events/migration-state";
import { newestEvent } from "../events/newest-event";
import type { SchemaEventRow } from "../events/schema-events-repository";
import { diffSnapshots } from "../pipeline/diff/diff";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";

import { isRecordedChecksum } from "./applied-checksums";
import { failedAttemptMayBePartial } from "./drift-reconcile";
import { isMarkCurrent } from "./old-builder-ledger";

export type ResolveMode =
  | "applied"
  | "rolled-back"
  | "failed-cleanup"
  | "removed";

/** Structural slice of SchemaEventsRepository this orchestration needs. */
export interface ResolveRepo {
  findFileApplies(filename: string): Promise<SchemaEventRow[]>;
  /** The filename's down-section attempts (`file_rollback` rows). */
  findFileRollbacks(filename: string): Promise<SchemaEventRow[]>;
  insertEvent(values: Record<string, unknown>): Promise<string>;
  supersede(args: {
    supersededEventIds: string[];
    byEventId: string;
  }): Promise<void>;
  markRolledBack(id: string, input?: { note?: string | null }): Promise<void>;
  /** Record a checksum on a row in place (`SchemaEventsRepository.recordChecksum`). */
  recordChecksum(id: string, sha256: string, note: string): Promise<void>;
  /** The newest old Schema Builder mark of each file (`currentOldBuilderMarks`). */
  currentOldBuilderMarks(): Promise<Map<string, SchemaEventRow>>;
  /** Record an applied migration's file removed on purpose (`SchemaEventsRepository.recordRemoval`). */
  recordRemoval(input: {
    filename: string;
    sha256: string | null;
  }): Promise<string>;
  /** Every recorded removal (`SchemaEventsRepository.listFileRemovals`). */
  listFileRemovals(): Promise<SchemaEventRow[]>;
}

export interface ResolveMigrationArgs {
  mode: ResolveMode;
  /** Bare or `.sql`-suffixed migration name; normalized internally. */
  filename: string;
  skipVerify?: boolean;
  /**
   * `--file-missing`: with `--rolled-back`, the operator says explicitly that
   * the file is gone from the folder, so it is not read. Refused while the
   * file is there.
   */
  fileMissing?: boolean;
  /**
   * The database the ledger lives in. It decides whether an attempt that did
   * not finish can have left part of a file's work behind
   * (`hasNoSnapshotToCompare`).
   */
  dialect: SupportedDialect;
  repo: ResolveRepo;
  /** True iff `migrations/<name>.sql` exists on disk. */
  fileExists: (filename: string) => Promise<boolean>;
  /** The file's paired target snapshot, or null if absent. */
  loadTargetSnapshot: () => Promise<NextlySchemaSnapshot | null>;
  /** True iff the file's first line is `-- nextly:no-transaction`. */
  marksNoTransaction: () => Promise<boolean>;
  /**
   * The checksum of the file's whole text as it stands (`checksumOf`), which
   * `--applied` records. Read only by `--applied`.
   */
  fileChecksum: () => Promise<string>;
  /** Live managed-user-table snapshot. */
  introspectLive: () => Promise<NextlySchemaSnapshot>;
  /**
   * Runs a mode's ledger writes in one transaction, handing them `repo`
   * bound to it, so a process stopping between them leaves none written.
   * Absent, they are written through `repo` as they come: the caller is
   * already inside a transaction, or has none to give.
   */
  atomically?: <T>(work: (repo: ResolveRepo) => Promise<T>) => Promise<T>;
}

/** A mode's ledger writes, run as `atomically` says. */
function writeLedger<T>(
  args: ResolveMigrationArgs,
  work: (repo: ResolveRepo) => Promise<T>
): Promise<T> {
  return args.atomically ? args.atomically(work) : work(args.repo);
}

export type ResolveResult =
  | {
      kind: "applied";
      eventId: string;
      supersededFailedId: string | null;
      /** False when nothing was compared: skipped, or no snapshot to compare. */
      verified: boolean;
    }
  | {
      kind: "checksum-accepted";
      /** The applied row the new checksum was recorded on. */
      eventId: string;
      /** The checksum it carried before, or null where it carried none. */
      previous: string | null;
    }
  | { kind: "rolled-back"; eventId: string }
  | { kind: "removed"; eventId: string }
  | {
      kind: "failed-cleanup";
      /**
       * Each attempt flipped to rolled_back, failed or unfinished, newest
       * first.
       */
      updatedIds: string[];
    }
  | { kind: "noop"; reason: string };

const NOTE = "manual-resolve";

function equiv(a: NextlySchemaSnapshot, b: NextlySchemaSnapshot): boolean {
  return diffSnapshots(a, b).length === 0;
}

export async function resolveMigration(
  args: ResolveMigrationArgs
): Promise<ResolveResult> {
  const filename = ledgerFilename(args.filename);

  switch (args.mode) {
    case "applied":
      return resolveApplied(args, filename);
    case "rolled-back":
      return resolveRolledBack(args, filename);
    case "failed-cleanup":
      return resolveFailedCleanup(args, filename);
    case "removed":
      return resolveRemoved(args, filename);
    default: {
      const _exhaustive: never = args.mode;
      throw new Error(`Unsupported resolve mode: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Refuses to mark a plugin module applied. `nextly migrate` records a module
 * together with the tables it owns, and a row written here would leave them
 * without an owner; clearing the module's failed attempt hands it back to
 * `nextly migrate`, which records it when the database stands at its result.
 */
function assertAppFile(filename: string): void {
  if (!isPluginLedgerRow(filename)) return;
  throw new NextlyError({
    code: "NEXTLY_MIGRATION_RESOLVE_PRECONDITION",
    publicMessage: `${filename} is a plugin module, which \`nextly migrate\` records applied together with the tables it owns. Run \`nextly migrate:resolve --failed-cleanup ${filename}\` and then \`nextly migrate\`: it records the module applied when the database stands at its result, and runs it when the database stands at its start.`,
  });
}

async function resolveApplied(
  args: ResolveMigrationArgs,
  filename: string
): Promise<ResolveResult> {
  assertAppFile(filename);
  if (!(await args.fileExists(filename))) {
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_FILE_MISSING",
      publicMessage: `Migration file not found: ${filename}`,
    });
  }

  const rows = await args.repo.findFileApplies(filename);
  const standing = standingOf(filename, rows);
  const marked = isMarkCurrent(
    (await args.repo.currentOldBuilderMarks()).get(filename)
  );
  if (standing.state === "applied" && standing.outcome !== undefined) {
    return acceptChecksum(args, filename, standing.outcome, rows, marked);
  }

  const verified = args.skipVerify
    ? false
    : await verifyTarget(args, filename, rows);

  // The applied row and the failures it supersedes, written together. It
  // records the file's checksum as a run does, so a later edit is caught.
  const failed = unresolvedAttempts(filename, rows);
  const sha256 = await args.fileChecksum();
  const eventId = await writeLedger(args, async repo => {
    const id = await repo.insertEvent({
      eventType: "file_apply",
      status: "applied",
      source: "cli-migrate",
      filename,
      sha256,
      endedAt: new Date(),
      statementsExecuted: 0,
      note: NOTE,
    });
    if (failed.length > 0) {
      await repo.supersede({
        supersededEventIds: failed.map(row => row.id),
        byEventId: id,
      });
    }
    if (marked) await withdrawMark(repo, filename, sha256);
    return id;
  });

  return {
    kind: "applied",
    eventId,
    supersededFailedId: failed[0]?.id ?? null,
    verified,
  };
}

/**
 * Withdraws the old Schema Builder mark of `filename`: a newer mark recorded
 * as `superseded`, which `isMarkCurrent` reads as no mark. The file and its
 * rows are then judged as any file and rows. Only `--applied` withdraws one,
 * in the write that records the file's checksum.
 */
async function withdrawMark(
  repo: ResolveRepo,
  filename: string,
  sha256: string
): Promise<void> {
  await repo.insertEvent({
    eventType: "old_builder_file",
    status: "superseded",
    source: "cli-migrate",
    filename,
    sha256,
    endedAt: new Date(),
    note: "accepted as a migration",
  });
}

/**
 * `--applied` on a migration already applied: accept its file as it now
 * reads, recording the new checksum on the applied row in place, so
 * `nextly migrate` stops refusing the edit. Nothing to do where the file
 * still matches.
 *
 * Refused while the migration has an unresolved attempt, its down section's
 * included: that attempt is judged against the text it ran, which the
 * applied row's checksum names, and the operator first records how it
 * ended (`--failed-cleanup`, or `--rolled-back` for a finished down section).
 */
async function acceptChecksum(
  args: ResolveMigrationArgs,
  filename: string,
  outcome: SchemaEventRow,
  rows: readonly SchemaEventRow[],
  /** A mark names the file as an old Schema Builder file's; accepting withdraws it. */
  marked: boolean
): Promise<ResolveResult> {
  const attempts = [...rows, ...(await args.repo.findFileRollbacks(filename))];
  if (migrationStanding(attempts).unresolvedAttempt !== undefined) {
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_RESOLVE_PRECONDITION",
      publicMessage: `${filename} has an unresolved attempt, so its changed file is not accepted yet. Record how that attempt ended first: \`nextly migrate:resolve --failed-cleanup ${filename}\` if you reversed what of it ran, or \`nextly migrate:resolve --rolled-back ${filename}\` if you finished its down section. Then run \`nextly migrate:resolve --applied ${filename}\` again.`,
    });
  }
  const sha256 = await args.fileChecksum();
  if (outcome.sha256 === sha256) {
    // A marked file accepted as it stands, its content unchanged (a snapshot
    // placed beside it): the mark is withdrawn and the checksum kept.
    if (marked) {
      await writeLedger(args, repo => withdrawMark(repo, filename, sha256));
      return {
        kind: "checksum-accepted",
        eventId: outcome.id,
        previous: outcome.sha256,
      };
    }
    return { kind: "noop", reason: `${filename} is already marked applied.` };
  }
  // Accepting an edit holds the database to the file as it now reads, as
  // recording a file applied does, unless the operator skips the comparison.
  if (!args.skipVerify) await verifyTarget(args, filename, rows);
  const previous = isRecordedChecksum(outcome.sha256) ? outcome.sha256 : "none";
  await writeLedger(args, async repo => {
    await repo.recordChecksum(
      outcome.id,
      sha256,
      `checksum accepted (was ${previous})`
    );
    if (marked) await withdrawMark(repo, filename, sha256);
  });
  return {
    kind: "checksum-accepted",
    eventId: outcome.id,
    previous: outcome.sha256,
  };
}

/**
 * Hold the live schema to the file's target snapshot before it is recorded.
 * True when it was compared and matched; false when there was nothing to
 * compare it with.
 *
 * A file without its snapshot is refused, so that recording it unchecked is
 * the operator's explicit `--skip-verify`, except in the cases the recovery
 * itself leads to (`hasNoSnapshotToCompare`). A file that does have one is
 * always compared.
 */
async function verifyTarget(
  args: ResolveMigrationArgs,
  filename: string,
  rows: readonly SchemaEventRow[]
): Promise<boolean> {
  const target = await args.loadTargetSnapshot();
  if (!target) {
    if (await hasNoSnapshotToCompare(args, rows)) return false;
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_SNAPSHOT_MISSING",
      publicMessage: `No paired snapshot for ${filename}; cannot verify. Re-run with --skip-verify to override.`,
    });
  }
  const live = await args.introspectLive();
  if (!equiv(live, target)) {
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_RESOLVE_DRIFT",
      publicMessage: `Live schema does not match the target snapshot for ${filename}. Resolve the drift or re-run with --skip-verify.`,
    });
  }
  return true;
}

/**
 * Whether a file with no snapshot is recorded without a comparison rather
 * than refused.
 *
 * A file marked `-- nextly:no-transaction` is written by
 * `migrate:create --blank --no-transaction`, and a blank file is paired with
 * no snapshot; a generated file is never marked, because the marker would
 * change the text its snapshot was taken over. On MySQL, whose DDL commits
 * as it runs, an unmarked blank file run in a transaction can also stop
 * part way: it has an unresolved attempt (`standingOf`), and
 * the partially-applied refusal tells the operator to mark it applied once
 * its statements are finished by hand. Neither has anything to compare
 * against, and refusing either would make the recovery the refusal names
 * need `--skip-verify`.
 *
 * On PostgreSQL and SQLite an unfinished attempt of an unmarked file was
 * undone whole, so none of it ran: recording it unchecked would record a
 * file that never ran, and it stays refused.
 */
async function hasNoSnapshotToCompare(
  args: ResolveMigrationArgs,
  rows: readonly SchemaEventRow[]
): Promise<boolean> {
  if (await args.marksNoTransaction()) return true;
  return (
    failedAttemptMayBePartial({ transaction: true }, args.dialect) &&
    standingOf(ledgerFilename(args.filename), rows).unresolvedAttempt !==
      undefined
  );
}

async function resolveRolledBack(
  args: ResolveMigrationArgs,
  filename: string
): Promise<ResolveResult> {
  await assertFileAsSaid(args, filename);

  const rows = await args.repo.findFileApplies(filename);
  const current = standingOf(filename, rows);
  // Already rolled back, unless an attempt since is unresolved and the file
  // is gone: that attempt is what `--file-missing` retires below.
  if (
    current.state === "rolled_back" &&
    (current.unresolvedAttempt === undefined || args.fileMissing !== true)
  ) {
    return { kind: "noop", reason: `${filename} is already rolled back.` };
  }
  // With the file gone, an attempt a newer build left unfinished is retired
  // with the applied rows: nothing here can finish it, and the operator has
  // said what of it ran is reversed.
  const appliedRows = rows.filter(
    r =>
      r.status === "applied" ||
      (args.fileMissing === true &&
        !isPluginLedgerRow(filename) &&
        unresolvedAttempts(filename, rows).includes(r))
  );
  if (appliedRows.length === 0) {
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_RESOLVE_PRECONDITION",
      publicMessage: `Cannot roll back ${filename}: no prior applied event exists.`,
    });
  }

  // Retire the prior applied row(s) by superseding them with this rolled_back
  // event, in the same transaction. Without this, the partial unique index
  // (filename WHERE status='applied') still sees a live applied row and the
  // next `migrate` re-apply fails with a UNIQUE constraint violation.
  //
  // The rollback row names what it retires in its own insert, so it is a
  // rollback from its first write. Outside a transaction (a DOWN marked to
  // run outside one, or on MySQL, whose schema statements end the
  // transaction they ran in) a stop can fall between this insert and
  // retiring the applied rows; a row retiring nothing would read as a
  // cleared attempt (`isOutcome`), and the migration as still applied.
  const retired = appliedRows.map(r => r.id);
  const eventId = await writeLedger(args, async repo => {
    const id = await repo.insertEvent({
      eventType: "file_apply",
      status: "rolled_back",
      source: "cli-migrate",
      filename,
      endedAt: new Date(),
      note: NOTE,
      supersededEventIds: retired,
    });
    await repo.supersede({
      supersededEventIds: retired,
      byEventId: id,
    });
    return id;
  });
  return { kind: "rolled-back", eventId };
}

/**
 * Refuses a `--rolled-back` that says the wrong thing about the file: one
 * the folder lacks needs `--file-missing`, said explicitly, and one it holds
 * refuses the flag, so a typo never records a rollback of the wrong file.
 */
async function assertFileAsSaid(
  args: ResolveMigrationArgs,
  filename: string
): Promise<void> {
  const exists = await args.fileExists(filename);
  if (!exists && args.fileMissing !== true) {
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_FILE_MISSING",
      publicMessage: `Migration file not found: ${filename}. If it is gone from the folder on purpose, say so: \`nextly migrate:resolve --rolled-back ${filename} --file-missing\`.`,
    });
  }
  if (exists && args.fileMissing === true) {
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_RESOLVE_PRECONDITION",
      publicMessage: `${filename} is in the migrations folder, so --file-missing does not apply: run \`nextly migrate:resolve --rolled-back ${filename}\` without it.`,
    });
  }
}

/**
 * Records that an applied app migration's file was removed from the folder on
 * purpose (`recordRemoval`), with the checksum its applied outcome carries.
 * The migration stays applied: the record is no outcome, so it is never run
 * again if its file returns, and is checked against that checksum. Refused
 * while the file is there, for a migration not applied, and over an attempt
 * a newer build left unfinished, which `--rolled-back --file-missing` settles.
 */
async function resolveRemoved(
  args: ResolveMigrationArgs,
  filename: string
): Promise<ResolveResult> {
  assertAppFile(filename);
  const refuse = (message: string) =>
    new NextlyError({
      code: "NEXTLY_MIGRATION_RESOLVE_PRECONDITION",
      publicMessage: message,
    });
  if (await args.fileExists(filename)) {
    throw refuse(
      `${filename} is in the migrations folder, so there is no removal to record.`
    );
  }
  // Its down section's attempts too, as every history check reads them.
  const rows = [
    ...(await args.repo.findFileApplies(filename)),
    ...(await args.repo.findFileRollbacks(filename)),
  ];
  const standing = migrationStanding(rows);
  if (standing.unresolvedAttempt !== undefined) {
    throw refuse(
      `${filename} has an attempt that did not finish, so the database may hold part of it. Record how it ended first: reverse what of it ran and run \`nextly migrate:resolve --failed-cleanup ${filename}\`, or, for a newer build's attempt at the file, \`nextly migrate:resolve --rolled-back ${filename} --file-missing\`.`
    );
  }
  if (standing.state !== "applied" || standing.outcome === undefined) {
    throw refuse(
      `${filename} is not applied, so its removal needs no record: a migration the ledger does not record applied is never counted as missing.`
    );
  }
  // The checksum a returning file is held to: a row an earlier version wrote
  // without one could not hold it, and the next run would record the
  // returning file's checksum as if it matched.
  if (!isRecordedChecksum(standing.outcome.sha256)) {
    throw refuse(
      `${filename}'s applied record carries no checksum, so a file that returns could not be checked against it. Put the file back as it was when it ran and run \`nextly migrate\` once, which records its checksum, then remove it and record the removal.`
    );
  }
  // Recorded already for the outcome it stands at now.
  if (
    removedOnPurpose(rows, await args.repo.listFileRemovals()).has(filename)
  ) {
    return {
      kind: "noop",
      reason: `${filename}'s removal is already recorded.`,
    };
  }
  const sha256 = standing.outcome.sha256;
  const eventId = await writeLedger(args, repo =>
    repo.recordRemoval({ filename, sha256 })
  );
  return { kind: "removed", eventId };
}

async function resolveFailedCleanup(
  args: ResolveMigrationArgs,
  filename: string
): Promise<ResolveResult> {
  // An app file's down section records its attempts as `file_rollback` rows,
  // and a stopped one is cleared as its UP's are: once the operator has
  // reversed what of it ran, the migration stays applied. A plugin module
  // keeps its history's rule, read from its `file_apply` rows alone.
  const rows = isPluginLedgerRow(filename)
    ? await args.repo.findFileApplies(filename)
    : [
        ...(await args.repo.findFileApplies(filename)),
        ...(await args.repo.findFileRollbacks(filename)),
      ];
  // Every unresolved attempt, since clearing only the newest would leave the
  // next one unresolved and `nextly migrate` refusing the file again; one an
  // outcome already resolved is history the file has moved past.
  const failed = unresolvedAttempts(filename, rows);
  if (failed.length === 0) {
    if (standingOf(filename, rows).state === "rolled_back") {
      return { kind: "noop", reason: `${filename} is already rolled back.` };
    }
    if (attemptCleared(newestEvent(rows))) {
      return {
        kind: "noop",
        reason: `${filename}'s attempts are already cleaned up.`,
      };
    }
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_RESOLVE_PRECONDITION",
      publicMessage: `No failed or unfinished attempt found for ${filename}; nothing to clean up.`,
    });
  }
  // Flipped in place rather than answered with a new row, so each attempt
  // keeps its own start and end times and its error, and the history still
  // reads in order. A cleared attempt retires nothing, so it is not an
  // outcome (`isOutcome`): an applied migration stays applied.
  await writeLedger(args, async repo => {
    for (const row of failed) {
      await repo.markRolledBack(row.id, { note: NOTE });
    }
  });
  return {
    kind: "failed-cleanup",
    updatedIds: failed.map(row => row.id),
  };
}
