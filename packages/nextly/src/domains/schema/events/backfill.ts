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
  sha256: string;
  status: string;
  appliedAt: Date | null;
  appliedBy: string | null;
  durationMs: number | null;
  errorJson: unknown;
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
