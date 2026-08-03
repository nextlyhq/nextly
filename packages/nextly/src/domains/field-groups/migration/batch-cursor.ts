/**
 * How far a batched row rewrite got, kept across a crash.
 *
 * A rewrite over a table that grows without bound cannot be one transaction, so
 * it runs in batches; without a record of where it stopped, every resume would
 * re-read the whole table from the start.
 *
 * This is deliberately weaker than the migration marker next to it, and the
 * difference is the whole design. The marker is authoritative: an unreadable one
 * refuses, because treating it as absent would restart work that may already
 * have renamed objects. A cursor is an **optimisation**. Starting a batch
 * rewrite from the beginning is always correct — the rewrite is idempotent and
 * skips rows that no longer need it — so anything unexpected here resolves to
 * "start over" rather than to a refusal that would strand a run over a value
 * that cannot make it wrong.
 *
 * Two rules keep it from becoming load-bearing by accident:
 *
 * - It is written only **after** its batch has committed, so it can lag and can
 *   never lead. A cursor that could commit while its batch rolled back would
 *   skip rows silently, which is the one failure this must not have.
 * - It carries the run that wrote it. A resume reuses the recorded migration id,
 *   so matching on it accepts exactly the run that produced the cursor and
 *   ignores one left behind by any other — including a run in the other
 *   direction, whose position means the opposite thing.
 *
 * @module domains/field-groups/migration/batch-cursor
 */

import type { MetaService } from "../../meta/services/meta-service";

/**
 * Prefix for the `nextly_meta` key a step's cursor lives under.
 *
 * Namespaced beneath the marker's own key so an operator reading the table sees
 * the two as one migration's state, and keyed by step so a position recorded for
 * one step can never be read as another's.
 */
const CURSOR_KEY_PREFIX = "field_groups.storage_migration.cursor.";

/** The `nextly_meta` key holding one step's cursor. */
export function batchCursorKey(stepId: string): string {
  return `${CURSOR_KEY_PREFIX}${stepId}`;
}

/** Stored shape. Read defensively: every field is untrusted on the way back in. */
interface StoredCursor {
  migrationId: string;
  after: string;
}

/**
 * Where this run's rewrite of this step stopped, or `null` to start over.
 *
 * `null` for an absent cursor, one written by a different run, and one that does
 * not decode — all three mean the same thing to a caller, and none of them is an
 * error worth refusing over.
 */
export async function readBatchCursor(
  meta: MetaService,
  args: { migrationId: string; stepId: string }
): Promise<string | null> {
  const value = await meta.get<unknown>(batchCursorKey(args.stepId));
  if (typeof value !== "object" || value === null) return null;

  const stored = value as Partial<StoredCursor>;
  if (stored.migrationId !== args.migrationId) return null;
  if (typeof stored.after !== "string" || stored.after.length === 0)
    return null;
  return stored.after;
}

/**
 * Record the position a committed batch reached.
 *
 * Call only once the batch's transaction has committed. Writing it earlier would
 * let the cursor survive a rolled-back batch and step the next run past rows
 * that were never rewritten.
 */
export async function writeBatchCursor(
  meta: MetaService,
  args: { migrationId: string; stepId: string; after: string }
): Promise<void> {
  const cursor: StoredCursor = {
    migrationId: args.migrationId,
    after: args.after,
  };
  await meta.set(batchCursorKey(args.stepId), cursor);
}

/**
 * Drop a finished step's cursor.
 *
 * Not required for correctness — a cursor past the end of a table selects
 * nothing, and one from another run is ignored — but a step that completed
 * should leave no state behind for an operator to interpret.
 */
export async function clearBatchCursor(
  meta: MetaService,
  args: { stepId: string }
): Promise<void> {
  await meta.delete(batchCursorKey(args.stepId));
}
