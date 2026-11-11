/**
 * The schema epoch: one value, install-wide, that moves whenever a change makes a cached
 * collection schema wrong on other instances, such as a rename moving a collection to a new slug,
 * or a Builder save changing its fields.
 *
 * A collection's runtime table is cached by slug in each process (`CollectionSchemaCache`), and
 * the process that makes a change drops or replaces its own entries. Another instance cannot see
 * that, so before this it kept mapping the old slug to the renamed collection's table until it
 * restarted. Now a change writes a new epoch beside it, in its own transaction, and a cache hit
 * asks whether the epoch moved, at most once per {@link SCHEMA_EPOCH_TTL_MS}, dropping what it can
 * rebuild when it did. That interval bounds how long another instance can serve a stale table.
 *
 * Kept in `nextly_meta` under {@link SCHEMA_EPOCH_KEY}, so no migration is needed. The value is a
 * random generation rather than a counter, since two instances bumping at once would otherwise
 * write the same number and each miss the other's change. A database without the table, or with
 * no epoch written yet, reads as an epoch that has not moved: the caches then behave as they did
 * before, per process.
 *
 * @module domains/dynamic-collections/services/schema-epoch
 */
import { randomUUID } from "node:crypto";

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

/** The `nextly_meta` key the epoch is kept under. */
export const SCHEMA_EPOCH_KEY = "schema-epoch";

/** How long a read of the epoch is reused: the bound on another instance's staleness. */
export const SCHEMA_EPOCH_TTL_MS = 1000;

const META_TABLE = "nextly_meta";

/**
 * A stored value as the generation it holds. The value column is JSON, which stores the text a
 * writer gave it, and MySQL's driver encodes that text once more: unwrapped until it is no longer
 * JSON text holding a string, the generation reads the same on every dialect.
 */
function generationOf(stored: unknown): string | null {
  let value = stored;
  for (let depth = 0; depth < 3 && typeof value === "string"; depth++) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed !== "string") break;
      value = parsed;
    } catch {
      break;
    }
  }
  return typeof value === "string" ? value : null;
}

/**
 * Moves the epoch on `tx`, the transaction of the change that makes cached schemas wrong, so the
 * move lands only if the change does.
 */
export async function bumpSchemaEpoch(
  tx: Pick<TransactionContext, "upsert">
): Promise<void> {
  await tx.upsert(
    META_TABLE,
    {
      key: SCHEMA_EPOCH_KEY,
      value: JSON.stringify(randomUUID()),
      updated_at: new Date(),
    },
    { conflictColumns: ["key"], updateColumns: ["value", "updated_at"] }
  );
}

/** Reads the stored generation; null where there is none, or no table to hold one. */
async function readGeneration(
  reader: Pick<TransactionContext, "select">
): Promise<string | null> {
  try {
    const [row] = await reader.select<{ value: unknown }>(META_TABLE, {
      columns: ["value"],
      where: { and: [{ column: "key", op: "=", value: SCHEMA_EPOCH_KEY }] },
      limit: 1,
    });
    return row ? generationOf(row.value) : null;
  } catch {
    // No table yet on an install that has not reconciled its core tables: the caches keep
    // their per-process behaviour rather than failing the read that asked.
    return null;
  }
}

/**
 * What one cache knows of the epoch: the generation it last saw, and when. A process shares one
 * cache between its file managers, so this is, in effect, what the process knows.
 */
export class SchemaEpochWatch {
  /** The generation last read; undefined until the first look. */
  private seen: string | null | undefined;
  private readAt = 0;
  private inFlight: Promise<boolean> | null = null;

  /**
   * Whether the epoch moved since this watch last looked: read at most once per
   * {@link SCHEMA_EPOCH_TTL_MS}, every caller in the meantime sharing the answer. The first look
   * records the epoch and answers that it has not moved, since nothing was cached under an
   * earlier one this watch could know of.
   */
  moved(reader: Pick<TransactionContext, "select">): Promise<boolean> {
    if (Date.now() - this.readAt < SCHEMA_EPOCH_TTL_MS) {
      return Promise.resolve(false);
    }
    this.inFlight ??= readGeneration(reader)
      .then(generation => {
        const moved = this.seen !== undefined && generation !== this.seen;
        this.seen = generation;
        this.readAt = Date.now();
        return moved;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }
}
