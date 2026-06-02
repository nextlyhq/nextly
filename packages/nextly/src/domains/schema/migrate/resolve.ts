/**
 * `nextly migrate:resolve` — operator recovery (spec §4.8).
 *
 * Flips `file_apply` bookkeeping without (re-)running SQL, for the three
 * recovery situations the spec enumerates:
 *   --applied        record a file as applied (live must equal the file's
 *                    target snapshot, unless --skip-verify); supersede a prior
 *                    failed row.
 *   --rolled-back    record a rolled_back event so the next `migrate` re-runs
 *                    the file (requires a prior applied row).
 *   --failed-cleanup flip a stuck failed row to rolled_back so the .sql can be
 *                    edited before the next attempt (no new row).
 *
 * Effects (repo, fs existence, snapshot load, live introspection) are injected
 * so the state machine unit-tests against the in-memory SQLite fixture without
 * a CLI shell. Equivalence (spec §4.2) is "empty diff" via the diff engine.
 *
 * @module domains/schema/migrate/resolve
 * @since v0.0.3-alpha (Plan C3)
 */
import { NextlyError } from "../../../errors";
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
  /** Live managed-user-table snapshot. */
  introspectLive: () => Promise<NextlySchemaSnapshot>;
}

export type ResolveResult =
  | { kind: "applied"; eventId: string; supersededFailedId: string | null }
  | { kind: "rolled-back"; eventId: string }
  | { kind: "failed-cleanup"; updatedId: string }
  | { kind: "noop"; reason: string };

const NOTE = "manual-resolve";

function withSqlExt(name: string): string {
  return name.endsWith(".sql") ? name : `${name}.sql`;
}

function equiv(a: NextlySchemaSnapshot, b: NextlySchemaSnapshot): boolean {
  return diffSnapshots(a, b).length === 0;
}

export async function resolveMigration(
  args: ResolveMigrationArgs
): Promise<ResolveResult> {
  const filename = withSqlExt(args.filename);

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

async function resolveApplied(
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
  if (rows.some(r => r.status === "applied")) {
    return { kind: "noop", reason: `${filename} is already marked applied.` };
  }

  if (!args.skipVerify) {
    const target = await args.loadTargetSnapshot();
    if (!target) {
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
  }

  const eventId = await args.repo.insertEvent({
    eventType: "file_apply",
    status: "applied",
    source: "cli-migrate",
    filename,
    startedAt: new Date(),
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

  return { kind: "applied", eventId, supersededFailedId: failed?.id ?? null };
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
    startedAt: new Date(),
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
