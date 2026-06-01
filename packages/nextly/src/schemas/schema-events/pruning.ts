/**
 * Retention pruning for `nextly_schema_events` (spec §4.3.3) with the
 * superseded-row protection invariant (spec §4.3.2).
 *
 * Pure over a row list so it is trivially unit-testable; the repository
 * supplies rows and performs the DELETE.
 *
 * @module schemas/schema-events/pruning
 * @since v0.0.3-alpha (Plan B)
 */

import type { SchemaEventType } from "./types";

/** Only these event types are ever eligible for pruning. */
export const PRUNABLE_EVENT_TYPES: ReadonlySet<SchemaEventType> = new Set([
  "dev_push",
  "ui_save",
  "db_sync",
]);

/** Minimal row shape the pruner needs. */
export interface PrunableRow {
  id: string;
  eventType: SchemaEventType;
  startedAt: Date;
  supersededEventIds: string[] | null;
  supersededBy: string | null;
}

export interface PruneOptions {
  /** Rows older than this many days are eligible. 0 (or less) = never prune. */
  retentionDays: number;
  /** Current time (injected for deterministic tests). */
  now: Date;
}

/**
 * Returns the ids of rows that may be safely deleted.
 *
 * A row is prunable iff: its event_type is in PRUNABLE_EVENT_TYPES, it is
 * older than the retention window, and it is NOT referenced by any other
 * row's `superseded_event_ids` or `superseded_by` (§4.3.2).
 */
export function selectPrunableEventIds(
  rows: readonly PrunableRow[],
  options: PruneOptions
): string[] {
  if (options.retentionDays <= 0) return [];

  const cutoff =
    options.now.getTime() - options.retentionDays * 24 * 60 * 60 * 1000;

  // Build the set of ids that are protected because something references them.
  const referenced = new Set<string>();
  for (const row of rows) {
    if (Array.isArray(row.supersededEventIds)) {
      for (const id of row.supersededEventIds) referenced.add(id);
    }
    if (row.supersededBy) referenced.add(row.supersededBy);
  }

  return rows
    .filter(
      row =>
        PRUNABLE_EVENT_TYPES.has(row.eventType) &&
        row.startedAt.getTime() < cutoff &&
        !referenced.has(row.id)
    )
    .map(row => row.id);
}
