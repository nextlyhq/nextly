/**
 * Removing a security table's rows past a cutoff, in batches, within the
 * bounds a retention pass gives: what the one-purpose secrets' sweep and the
 * received-webhook claims' sweep both do, each with its own table, columns
 * and cutoff.
 *
 * Each batch reads up to 500 keys past the cutoff and deletes them in a
 * transaction of its own, the cutoff checked again in the delete so a row
 * renewed since it was read is kept. A sweep stops between batches at its
 * deadline, and reports whether any batch was attempted, which the scheduled
 * drain tells apart from a sweep of an empty table.
 *
 * @module plugins/security/prune-in-batches
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

/** Rows removed per batch, each batch in a transaction of its own. */
const BATCH = 500;

/**
 * What a sweep needs from the database adapter. `transaction` is optional
 * only so a test double of the retention adapter need not supply one; every
 * real adapter has it, and the sweep uses it whenever it is there.
 */
export type PruneInBatchesAdapter = Pick<DrizzleAdapter, "select" | "delete"> &
  Partial<Pick<DrizzleAdapter, "transaction">>;

/** Bounds on one sweep. */
export interface PruneInBatchesLimits {
  /** At most this many batches, for a capped pass offered by a write. */
  maxBatches?: number;
  /**
   * Stop between batches once the clock reaches this moment: the scheduled
   * drain's wall-clock budget, which a sweep must not carry it past.
   */
  deadline?: number;
  /** The clock the deadline is read on; defaults to `Date.now`. */
  clock?: () => number;
}

/** Which rows a sweep removes. */
export interface PruneTarget {
  table: string;
  /** The text column each row is deleted by. */
  key: string;
  /** The time column compared with `cutoff`. */
  at: string;
  /** Rows whose `at` is earlier than this are removed. */
  cutoff: Date;
  /** Read the oldest first, so every old row goes in turn. */
  oldestFirst?: boolean;
}

/**
 * Remove `target`'s rows past its cutoff, in batches, within `limits`.
 * Returns how many rows went, and whether any batch was attempted.
 */
export async function pruneInBatches(
  adapter: PruneInBatchesAdapter,
  target: PruneTarget,
  limits: PruneInBatchesLimits = {}
): Promise<{ removed: number; started: boolean }> {
  const maxBatches = limits.maxBatches ?? Number.POSITIVE_INFINITY;
  const clock = limits.clock ?? Date.now;
  const past = { column: target.at, op: "<" as const, value: target.cutoff };
  let removed = 0;
  let started = false;
  for (let batch = 0; batch < maxBatches; batch++) {
    if (limits.deadline !== undefined && clock() >= limits.deadline) break;
    started = true;
    // Both tables key their rows by text: an id, or a hash.
    const rows = await adapter.select<Record<string, string>>(target.table, {
      columns: [target.key],
      where: { and: [past] },
      ...(target.oldestFirst
        ? { orderBy: [{ column: target.at, direction: "asc" as const }] }
        : {}),
      limit: BATCH,
    });
    if (rows.length === 0) break;
    const where = {
      and: [
        {
          column: target.key,
          op: "IN" as const,
          value: rows.map(row => row[target.key]),
        },
        past,
      ],
    };
    // In a transaction, never as a lone statement: on SQLite a lone statement
    // joins whatever transaction another flow has open and rolls back with it.
    removed += adapter.transaction
      ? await adapter.transaction(tx => tx.delete(target.table, where))
      : await adapter.delete(target.table, where);
    if (rows.length < BATCH) break;
  }
  return { removed, started };
}
