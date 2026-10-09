/**
 * `nextly migrate:resolve` — operator recovery.
 *
 * Flips `file_apply` bookkeeping without (re-)running SQL, for three
 * recovery situations:
 *   --applied        record a file as applied (live must equal the file's
 *                    target snapshot, unless --skip-verify, or the file has
 *                    none and is marked `-- nextly:no-transaction`, or the
 *                    database is MySQL and its newest attempt failed);
 *                    supersede the prior failed rows. An app file only: a
 *                    plugin module is recorded by `nextly migrate`, after
 *                    --failed-cleanup.
 *   --rolled-back    record a rolled_back event so the next `migrate` re-runs
 *                    the file (requires a prior applied row).
 *   --failed-cleanup flip the stuck attempts (every failed or unfinished one
 *                    since the file's last other event) to rolled_back so
 *                    the .sql can be edited before the next attempt (no new
 *                    row).
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
import { newestEvent, newestFirst } from "../events/newest-event";
import type { SchemaEventRow } from "../events/schema-events-repository";
import { diffSnapshots } from "../pipeline/diff/diff";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";

import {
  attemptUnfinished,
  failedAttemptMayBePartial,
} from "./drift-reconcile";

export type ResolveMode = "applied" | "rolled-back" | "failed-cleanup";

/** Structural slice of SchemaEventsRepository this orchestration needs. */
export interface ResolveRepo {
  findFileApplies(filename: string): Promise<SchemaEventRow[]>;
  insertEvent(values: Record<string, unknown>): Promise<string>;
  supersede(args: {
    supersededEventIds: string[];
    byEventId: string;
  }): Promise<void>;
  markRolledBack(id: string, input?: { note?: string | null }): Promise<void>;
}

export interface ResolveMigrationArgs {
  mode: ResolveMode;
  /** Bare or `.sql`-suffixed migration name; normalized internally. */
  filename: string;
  skipVerify?: boolean;
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
  /** Live managed-user-table snapshot. */
  introspectLive: () => Promise<NextlySchemaSnapshot>;
}

export type ResolveResult =
  | {
      kind: "applied";
      eventId: string;
      supersededFailedId: string | null;
      /** False when nothing was compared: skipped, or no snapshot to compare. */
      verified: boolean;
    }
  | { kind: "rolled-back"; eventId: string }
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
  if (rows.some(r => r.status === "applied")) {
    return { kind: "noop", reason: `${filename} is already marked applied.` };
  }

  const verified = args.skipVerify
    ? false
    : await verifyTarget(args, filename, rows);

  const eventId = await args.repo.insertEvent({
    eventType: "file_apply",
    status: "applied",
    source: "cli-migrate",
    filename,
    endedAt: new Date(),
    statementsExecuted: 0,
    note: NOTE,
  });

  const failed = unclearedFailures(rows);
  if (failed.length > 0) {
    await args.repo.supersede({
      supersededEventIds: failed.map(row => row.id),
      byEventId: eventId,
    });
  }

  return {
    kind: "applied",
    eventId,
    supersededFailedId: failed[0]?.id ?? null,
    verified,
  };
}

/**
 * The attempts that did not finish (`attemptUnfinished`: failed, or stopped
 * while `in_progress`) and no later event accounts for: the unbroken run of
 * them at the newest end of a file's history, newest first.
 *
 * What `--failed-cleanup` clears and `--applied` supersedes. Every one of
 * them is an attempt that may have left work behind, so clearing only one
 * would leave the next newest still unfinished, and `nextly migrate` refusing
 * the file again. One older than a later applied or rolled-back event is
 * history the file has already moved past, and is left as recorded.
 */
function unclearedFailures(rows: readonly SchemaEventRow[]): SchemaEventRow[] {
  const ordered = newestFirst(rows);
  const firstOther = ordered.findIndex(row => !attemptUnfinished(row));
  return firstOther === -1 ? ordered : ordered.slice(0, firstOther);
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
 * part way: its newest attempt did not finish (`attemptUnfinished`), and
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
    attemptUnfinished(newestEvent(rows))
  );
}

async function resolveRolledBack(
  args: ResolveMigrationArgs,
  filename: string
): Promise<ResolveResult> {
  if (!(await args.fileExists(filename))) {
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_FILE_MISSING",
      publicMessage: `Migration file not found: ${filename}`,
    });
  }

  const rows = await args.repo.findFileApplies(filename);
  const latest = newestEvent(rows);
  if (latest?.status === "rolled_back") {
    return { kind: "noop", reason: `${filename} is already rolled back.` };
  }
  const appliedRows = rows.filter(r => r.status === "applied");
  if (appliedRows.length === 0) {
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_RESOLVE_PRECONDITION",
      publicMessage: `Cannot roll back ${filename}: no prior applied event exists.`,
    });
  }

  const eventId = await args.repo.insertEvent({
    eventType: "file_apply",
    status: "rolled_back",
    source: "cli-migrate",
    filename,
    endedAt: new Date(),
    note: NOTE,
  });
  // Retire the prior applied row(s) by superseding them with this rolled_back
  // event. Without this, the partial unique index
  // (filename WHERE status='applied') still sees a live applied row and the
  // next `migrate` re-apply fails with a UNIQUE constraint violation.
  await args.repo.supersede({
    supersededEventIds: appliedRows.map(r => r.id),
    byEventId: eventId,
  });
  return { kind: "rolled-back", eventId };
}

async function resolveFailedCleanup(
  args: ResolveMigrationArgs,
  filename: string
): Promise<ResolveResult> {
  const rows = await args.repo.findFileApplies(filename);
  const failed = unclearedFailures(rows);
  if (failed.length === 0) {
    if (newestEvent(rows)?.status === "rolled_back") {
      return { kind: "noop", reason: `${filename} is already rolled back.` };
    }
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_RESOLVE_PRECONDITION",
      publicMessage: `No failed or unfinished attempt found for ${filename}; nothing to clean up.`,
    });
  }
  // Flipped in place rather than answered with a new row, so each attempt
  // keeps its own start and end times and its error, and the history still
  // reads in order.
  for (const row of failed) {
    await args.repo.markRolledBack(row.id, { note: NOTE });
  }
  return {
    kind: "failed-cleanup",
    updatedIds: failed.map(row => row.id),
  };
}
