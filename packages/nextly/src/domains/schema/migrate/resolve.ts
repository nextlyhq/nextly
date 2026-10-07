/**
 * `nextly migrate:resolve` — operator recovery.
 *
 * Flips `file_apply` bookkeeping without (re-)running SQL, for three
 * recovery situations:
 *   --applied        record a file as applied (live must equal the file's
 *                    target snapshot, unless --skip-verify, or the file is
 *                    marked `-- nextly:no-transaction` and has none);
 *                    supersede a prior failed row. An app file only: a
 *                    plugin module is recorded by `nextly migrate`, after
 *                    --failed-cleanup.
 *   --rolled-back    record a rolled_back event so the next `migrate` re-runs
 *                    the file (requires a prior applied row).
 *   --failed-cleanup flip a stuck failed row to rolled_back so the .sql can be
 *                    edited before the next attempt (no new row).
 *
 * Effects (repo, fs existence, snapshot load, live introspection) are injected
 * so the state machine unit-tests against the in-memory SQLite fixture without
 * a CLI shell. Two snapshots are equivalent when their diff is empty.
 *
 * @module domains/schema/migrate/resolve
 * @since v0.0.3-alpha
 */
import { NextlyError } from "../../../errors";
import { isPluginLedgerRow, ledgerFilename } from "../events/ledger-scope";
import { newestEvent } from "../events/newest-event";
import type { SchemaEventRow } from "../events/schema-events-repository";
import { diffSnapshots } from "../pipeline/diff/diff";
import type { NextlySchemaSnapshot } from "../pipeline/diff/types";

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
  | { kind: "failed-cleanup"; updatedId: string }
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

  const verified = args.skipVerify ? false : await verifyTarget(args, filename);

  const eventId = await args.repo.insertEvent({
    eventType: "file_apply",
    status: "applied",
    source: "cli-migrate",
    filename,
    endedAt: new Date(),
    statementsExecuted: 0,
    note: NOTE,
  });

  const failed = rows.find(r => r.status === "failed");
  if (failed) {
    await args.repo.supersede({
      supersededEventIds: [failed.id],
      byEventId: eventId,
    });
  }

  return {
    kind: "applied",
    eventId,
    supersededFailedId: failed?.id ?? null,
    verified,
  };
}

/**
 * Hold the live schema to the file's target snapshot before it is recorded.
 * True when it was compared and matched; false when there was nothing to
 * compare it with.
 *
 * A file marked `-- nextly:no-transaction` is written by
 * `migrate:create --blank --no-transaction`, which pairs no snapshot with it:
 * a generated file is never marked, because the marker would change the text
 * its snapshot was taken over. Its missing snapshot is therefore the file's
 * design, not a lost artifact, and the check has nothing to hold it to. It is
 * also the file a partial failure tells the operator to mark applied, so
 * refusing it here would make that recovery need `--skip-verify`. Any other
 * file without its snapshot is still refused, and a marked file that does
 * have one is still compared.
 */
async function verifyTarget(
  args: ResolveMigrationArgs,
  filename: string
): Promise<boolean> {
  const target = await args.loadTargetSnapshot();
  if (!target) {
    if (await args.marksNoTransaction()) return false;
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
  const failed = rows.find(r => r.status === "failed");
  if (!failed) {
    if (rows.some(r => r.status === "rolled_back")) {
      return { kind: "noop", reason: `${filename} is already rolled back.` };
    }
    throw new NextlyError({
      code: "NEXTLY_MIGRATION_RESOLVE_PRECONDITION",
      publicMessage: `No failed event found for ${filename}; nothing to clean up.`,
    });
  }
  await args.repo.markRolledBack(failed.id, { note: NOTE });
  return { kind: "failed-cleanup", updatedId: failed.id };
}
