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
  /**
   * Tables whose rows belong to a removed row, by a column holding its key:
   * removed with it in the same transaction, first, so none outlives it.
   */
  dependents?: readonly { table: string; key: string }[];
  /**
   * Run in each batch's transaction before its rows are deleted, with the keys about to go:
   * removes other rows those take with them, and says how many it removed. `holdBack` keeps the
   * batch's own rows for a later batch: what they take with them was more than one batch's work,
   * and a row must not go before everything it takes.
   */
  beforeRemove?: (
    db: Pick<DrizzleAdapter, "select" | "delete">,
    keys: readonly string[]
  ) => Promise<BeforeRemoveResult>;
}

/** What {@link PruneTarget.beforeRemove} did. */
export interface BeforeRemoveResult {
  removed: number;
  /** Keep the batch's own rows for a later batch. */
  holdBack?: boolean;
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
    const keys = await readBatchKeys(adapter, target, past);
    if (keys.length === 0) break;
    const where = {
      and: [{ column: target.key, op: "IN" as const, value: keys }, past],
    };
    // In a transaction, never as a lone statement: on SQLite a lone statement
    // joins whatever transaction another flow has open and rolls back with it.
    const done = adapter.transaction
      ? await adapter.transaction(tx => removeBatch(tx, target, where))
      : await removeBatch(adapter, target, where);
    removed += done.removed;
    if (!anotherBatch(done, keys.length)) break;
  }
  return { removed, started };
}

/** Up to a batch of keys past the cutoff; both tables key their rows by text. */
async function readBatchKeys(
  adapter: PruneInBatchesAdapter,
  target: PruneTarget,
  past: { column: string; op: "<"; value: Date }
): Promise<string[]> {
  const rows = await adapter.select<Record<string, string>>(target.table, {
    columns: [target.key],
    where: { and: [past] },
    ...(target.oldestFirst
      ? { orderBy: [{ column: target.at, direction: "asc" as const }] }
      : {}),
    limit: BATCH,
  });
  return rows.map(row => row[target.key]);
}

/**
 * Whether the sweep reads another batch. A batch held back is read again by
 * the next one, which goes on from what this one removed; one that removed
 * nothing would only repeat. Otherwise a full batch means more may wait.
 */
function anotherBatch(
  done: { removed: number; heldBack: boolean },
  read: number
): boolean {
  return done.heldBack ? done.removed > 0 : read === BATCH;
}

type BatchWhere = {
  and: {
    column: string;
    op: "IN" | "<";
    value: string[] | Date;
  }[];
};

/**
 * Delete one batch's rows still matching `where`, after their dependents'.
 * With dependents, the rows still past the cutoff are read again first, so a
 * row renewed since the batch was read keeps its dependents as well.
 */
async function removeBatch(
  db: Pick<DrizzleAdapter, "select" | "delete">,
  target: PruneTarget,
  where: BatchWhere
): Promise<{ removed: number; heldBack: boolean }> {
  if (
    (target.dependents && target.dependents.length > 0) ||
    target.beforeRemove
  ) {
    const still = await db.select<Record<string, string>>(target.table, {
      columns: [target.key],
      where,
    });
    if (still.length === 0) return { removed: 0, heldBack: false };
    const keys = still.map(row => row[target.key]);
    // First, so a batch held back has lost none of its dependents either.
    const alongside = target.beforeRemove
      ? await target.beforeRemove(db, keys)
      : { removed: 0 };
    if (alongside.holdBack) {
      return { removed: alongside.removed, heldBack: true };
    }
    for (const dependent of target.dependents ?? []) {
      await db.delete(dependent.table, {
        and: [{ column: dependent.key, op: "IN", value: keys }],
      });
    }
    const own = await db.delete(target.table, {
      and: [
        { column: target.key, op: "IN", value: keys },
        ...where.and.slice(1),
      ],
    });
    return { removed: alongside.removed + own, heldBack: false };
  }
  return { removed: await db.delete(target.table, where), heldBack: false };
}
