/**
 * Pure mapping of legacy bookkeeping rows → `nextly_schema_events` insert
 * rows (spec §4.10.2). DB-free; `nextly upgrade` reads legacy rows, runs
 * these mappers, and inserts the results.
 *
 * @module domains/schema/events/backfill
 * @since v0.0.3-alpha (Plan B)
 */

import type {
  SchemaEventScopeKind,
  SchemaEventSource,
  SchemaEventStatus,
  SchemaEventType,
} from "../../../schemas/schema-events/types";

/** Subset of `nextly_migrations` columns the backfill consumes. */
export interface LegacyMigrationsRow {
  filename: string;
  /** `null` where the shape kept no checksum, or kept none for this record. */
  sha256: string | null;
  status: string;
  appliedAt: Date | null;
  appliedBy: string | null;
  durationMs: number | null;
  errorJson: unknown;
}

/**
 * Which column of `nextly_migrations` holds each part of a record, in the
 * shape this database keeps it in. Earlier releases kept the table in more
 * than one shape:
 *
 * - the file ledger `nextly migrate` wrote before `nextly_schema_events`:
 *   `filename`, `sha256`, `status`, `applied_at`, `applied_by`,
 *   `duration_ms`, `error_json`;
 * - the shape before it, which a sync created as a system table: `name`,
 *   `checksum`, `status`, `error_message`, `executed_at` (renamed to
 *   `filename`, `sha256`, `error_json` and `applied_at` by the file ledger),
 *   plus `id` and `batch`;
 * - the adapters' own migration helper: `name`, `checksum`, `applied_at`,
 *   with no status, since it recorded only what applied.
 *
 * Each part is read from whichever of its names the table has, so all three
 * move the same way. `null` for a part the shape does not keep.
 */
export interface LegacyLedgerShape {
  filename: string;
  sha256: string | null;
  status: string | null;
  appliedAt: string | null;
  /** How a number in `appliedAt` counts time: seconds in `executed_at`, as that shape's default wrote it. */
  appliedAtUnit: "seconds" | "milliseconds";
  appliedBy: string | null;
  durationMs: string | null;
  /** `error_json` holds the structured error; `error_message`, its text. */
  error: string | null;
}

/**
 * The shape of a `nextly_migrations` table from its column names, or `null`
 * when it has no column naming the migration file: a table no release of
 * Nextly wrote, whose rows cannot be moved.
 */
export function legacyLedgerShape(
  columns: readonly string[]
): LegacyLedgerShape | null {
  const present = new Set(columns.map(column => column.toLowerCase()));
  const first = (...names: string[]): string | null =>
    names.find(name => present.has(name)) ?? null;
  const filename = first("filename", "name");
  if (filename === null) return null;
  const appliedAt = first("applied_at", "executed_at");
  return {
    filename,
    sha256: first("sha256", "checksum"),
    status: first("status"),
    appliedAt,
    appliedAtUnit: appliedAt === "executed_at" ? "seconds" : "milliseconds",
    appliedBy: first("applied_by"),
    durationMs: first("duration_ms"),
    error: first("error_json", "error_message"),
  };
}

/** What becomes of one `nextly_migrations` row. */
export type LegacyLedgerRead =
  | { kind: "move"; row: LegacyMigrationsRow }
  /** A record of a run that never finished: there is no outcome to move. */
  | { kind: "skip"; filename: string; status: string }
  /** A row whose meaning is not known: moving it would guess. */
  | { kind: "refuse"; reason: string };

/** SQLite's `CURRENT_TIMESTAMP` text, which is UTC with no zone written. */
const SQL_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;

/** A stored time as a date, or `null` when it holds none that reads as one. */
function legacyTime(
  value: unknown,
  unit: LegacyLedgerShape["appliedAtUnit"]
): Date | null {
  let date: Date | null = null;
  if (value instanceof Date) date = value;
  else if (typeof value === "number" || typeof value === "bigint") {
    const n = Number(value);
    date = new Date(unit === "seconds" ? n * 1000 : n);
  } else if (typeof value === "string" && value !== "") {
    if (/^\d+$/.test(value)) return legacyTime(Number(value), unit);
    date = new Date(
      SQL_DATETIME.test(value) ? `${value.replace(" ", "T")}Z` : value
    );
  }
  return date !== null && !Number.isNaN(date.getTime()) ? date : null;
}

const optionalText = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/** The value of the column holding a part, or `undefined` where the shape keeps no such part. */
const part = (raw: Record<string, unknown>, column: string | null): unknown =>
  column === null ? undefined : raw[column];

/** A record's status, lowercased: a shape with no status recorded only what applied. */
function statusOf(raw: Record<string, unknown>, shape: LegacyLedgerShape) {
  const stored = shape.status === null ? "applied" : raw[shape.status];
  return {
    stored,
    status: typeof stored === "string" ? stored.toLowerCase() : "",
  };
}

/** The error a failed record kept, as the events table keeps it: `error_message` is its text. */
function errorOf(raw: Record<string, unknown>, shape: LegacyLedgerShape) {
  const error = part(raw, shape.error);
  if (shape.error !== "error_message") return error ?? null;
  const message = optionalText(error);
  return message === null ? null : { message };
}

/** A moved record's parts, read through its table's shape. */
function movedRow(
  raw: Record<string, unknown>,
  shape: LegacyLedgerShape,
  filename: string,
  status: "applied" | "failed"
): LegacyMigrationsRow {
  const duration = part(raw, shape.durationMs);
  return {
    filename,
    sha256: optionalText(part(raw, shape.sha256)),
    status,
    appliedAt: legacyTime(part(raw, shape.appliedAt), shape.appliedAtUnit),
    appliedBy: optionalText(part(raw, shape.appliedBy)),
    durationMs:
      duration === null || duration === undefined ? null : Number(duration),
    errorJson: errorOf(raw, shape),
  };
}

/**
 * One `nextly_migrations` row, read through its table's shape. Applied and
 * failed records move. A record of a run still pending or running is
 * skipped, as the journal's unfinished rows are: no outcome was recorded.
 * Any other status, or a row naming no file, is refused, so nothing is
 * guessed into the ledger `nextly migrate` decides from.
 */
export function readLegacyLedgerRow(
  raw: Record<string, unknown>,
  shape: LegacyLedgerShape
): LegacyLedgerRead {
  const filename = optionalText(raw[shape.filename]);
  if (filename === null) {
    return { kind: "refuse", reason: "a record names no migration file" };
  }
  const { stored, status } = statusOf(raw, shape);
  if (status === "pending" || status === "running") {
    return { kind: "skip", filename, status };
  }
  if (status !== "applied" && status !== "failed") {
    return {
      kind: "refuse",
      reason: `the record of ${filename} has the status ${JSON.stringify(stored)}`,
    };
  }
  return { kind: "move", row: movedRow(raw, shape, filename, status) };
}

/** Subset of `nextly_migration_journal` columns the backfill consumes. */
export interface LegacyJournalRow {
  source: string;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  durationMs: number | null;
  scopeKind: string | null;
  scopeSlug: string | null;
}

/** Shape inserted into nextly_schema_events (id/startedAt defaulted by table). */
export interface BackfillEvent {
  eventType: SchemaEventType;
  status: SchemaEventStatus;
  source: SchemaEventSource;
  filename?: string | null;
  sha256?: string | null;
  scopeKind?: SchemaEventScopeKind | null;
  scopeSlug?: string | null;
  startedAt?: Date;
  endedAt?: Date | null;
  durationMs?: number | null;
  appliedBy?: string | null;
  errorJson?: unknown;
}

export function mapMigrationsRow(row: LegacyMigrationsRow): BackfillEvent {
  return {
    eventType: "file_apply",
    source: "cli-migrate",
    status: row.status === "failed" ? "failed" : "applied",
    filename: row.filename,
    sha256: row.sha256,
    startedAt: row.appliedAt ?? undefined,
    appliedBy: row.appliedBy,
    durationMs: row.durationMs,
    errorJson: row.errorJson ?? undefined,
  };
}

const JOURNAL_SOURCE_MAP: Record<string, SchemaEventType> = {
  code: "dev_push",
  ui: "ui_save",
  cli: "db_sync",
};

const JOURNAL_SOURCE_TO_EVENT_SOURCE: Record<string, SchemaEventSource> = {
  code: "dev-server",
  ui: "admin-ui",
  cli: "cli-sync",
};

/** Returns null for rows that were never finalized (skip with a warning). */
export function mapJournalRow(row: LegacyJournalRow): BackfillEvent | null {
  if (row.status === "in_progress" || row.status === "aborted") return null;

  const eventType = JOURNAL_SOURCE_MAP[row.source] ?? "dev_push";
  const source = JOURNAL_SOURCE_TO_EVENT_SOURCE[row.source] ?? "dev-server";

  return {
    eventType,
    source,
    status: row.status === "failed" ? "failed" : "applied",
    scopeKind: (row.scopeKind as SchemaEventScopeKind | null) ?? null,
    scopeSlug: row.scopeSlug,
    startedAt: row.startedAt ?? undefined,
    endedAt: row.endedAt,
    durationMs: row.durationMs,
  };
}

/** The synthesized pre-backfill core_apply row (spec §4.10.2 last row). */
export function synthesizedCoreApplyEvent(): BackfillEvent {
  return {
    eventType: "core_apply",
    status: "applied",
    source: "legacy-prebackfill",
    appliedBy: "nextly-upgrade",
  };
}
