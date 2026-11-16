/**
 * The composition graph lock: one row of the plugin's own
 * `page_builder__site_options` table, named `composition-graph-lock`, that
 * every write changing the composition graph locks inside its own
 * transaction, so those writes are judged one after another.
 *
 * ## Why a lock, and why this row
 *
 * The blocks field's validation judges a write before its transaction opens.
 * Two writes made at once can each pass against the graph as it stood before
 * the other: one component made to place a second while the second is made to
 * place the first, or a page placing a component while that component is made
 * deeper. Each is judged again inside its transaction, after it is stored
 * (`composition-rejudge`), and that second judgement is only sound if no
 * other write changing the graph can commit while it runs. Holding this row
 * makes sure of it: a second writer waits at the row until the first commits,
 * then judges against what the first stored.
 *
 * A row of a table the plugin already has rather than a table of its own.
 * The plugin's data migration puts the row in place once, on install and on
 * `nextly migrate` for an existing install, so a start writes nothing for
 * it; the first write finding it missing (on a database that migration has
 * not run on) inserts it. The row lock is the dialect's own and lasts
 * exactly as long as the transaction: an `UPDATE` of the row on PostgreSQL
 * and MySQL, which locks it until commit or rollback. SQLite takes no row
 * lock and needs none: its transactions open with `BEGIN IMMEDIATE`, which
 * already lets one writer in at a time.
 *
 * The row is written whenever it is locked, with a fresh value each time, so
 * MySQL, which counts the rows an update changed rather than the ones it
 * matched, still answers that one was locked.
 *
 * ## A transaction whose reads are older than the lock
 *
 * Holding the lock is only half of it: what the write then reads must be what
 * committed before it got the lock. Core opens a write's own transaction at
 * READ COMMITTED for that, but a write made in a transaction its caller opened
 * keeps the caller's isolation, and under MySQL's default, REPEATABLE READ,
 * every read answers from the snapshot the transaction's first read took. So
 * the lock is taken with a compare-and-set on the row's value as this
 * transaction reads it: a writer that committed since the snapshot changed the
 * value, the update matches nothing, and the row is read again. Under READ
 * COMMITTED the second read sees that writer's value and the lock is taken.
 * Under a snapshot it sees the same old value, and the write is refused as a
 * conflict to save again, rather than judged against a graph it cannot see.
 * PostgreSQL under REPEATABLE READ refuses such an update itself.
 *
 * @module composition-graph-lock
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { and, eq } from "@nextlyhq/plugin-sdk/db";
import type {
  isUniqueViolation,
  PluginTransaction,
} from "@nextlyhq/plugin-sdk/schema";

import { siteOptions } from "./schema/tables";

/** The lock row's name in the table. */
const COMPOSITION_GRAPH_LOCK = "composition-graph-lock";

/**
 * The cause a refusal names when the transaction's reads are older than the
 * last writer that held the lock: the write is sound to make again, from a
 * fresh read, as a write refused for a replaced version is.
 */
export const GRAPH_SNAPSHOT_RACED =
  "composition-graph-snapshot-older-than-lock";

/**
 * Whether a write was refused because its transaction read from a snapshot
 * older than the lock ({@link holdCompositionGraph}), wherever it sits in the
 * chain of causes. A refusal re-worded for its caller keeps the same cause, so
 * it is still told apart from every other conflict.
 */
export function isGraphSnapshotRefusal(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 10 && current instanceof Error; depth += 1) {
    if (
      current instanceof NextlyError &&
      current.logContext?.cause === GRAPH_SNAPSHOT_RACED
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

/**
 * The lock a read of a stored document takes on a write's transaction once
 * the write holds the graph lock, or is about to take it: none. A plain read
 * on the transaction's connection, which waits for no row lock and holds
 * none.
 *
 * Lock order is why. A write of a page or a Single takes its own row first,
 * as it stores it, and the graph lock after. A read under the graph lock that
 * took a row lock would take them the other way round: a removal holding the
 * graph lock would wait for a page's row while that page's save, holding its
 * row, waits for the graph lock, and a page save holding the graph lock would
 * wait for the Site Style Single's row while a removal, holding that row,
 * waits for the graph lock. Each pair waits on the other until the database
 * refuses one. What a plain read sees, per dialect, is the reader's to say
 * (`composition-rejudge`, `site-style-removal-lock`).
 */
export const UNLOCKED_READ = { lock: "none" } as const;

/** The dialect, as `ctx.dialect` names it. */
type Dialect = Parameters<typeof isUniqueViolation>[0];

/**
 * Lock the composition graph for the rest of `db`'s transaction: the write's
 * own, as an in-transaction handler is handed it.
 *
 * Where the row is not there yet (the plugin's data migration has not run on
 * this database), it is inserted, which locks it as well. It is read first,
 * so a write inserts it only when it is missing: once, as a rule. Two first
 * writes inserting it at once meet the unique index on `name`, and the one
 * that loses fails rather than going on unlocked. A transaction reading from a snapshot older
 * than the last writer that held the lock is refused (see the module).
 */
export async function holdCompositionGraph(
  db: Pick<PluginTransaction, "select" | "update" | "insert" | "table">,
  dialect: Dialect
): Promise<void> {
  if (dialect === "sqlite") return;
  const name = () => eq(db.table(siteOptions).name, COMPOSITION_GRAPH_LOCK);
  let seen: string | undefined;
  for (;;) {
    const row = await db.select(siteOptions).where(name()).first();
    const value = globalThis.crypto.randomUUID();
    if (row === null) {
      await db.insert(siteOptions, { name: COMPOSITION_GRAPH_LOCK, value });
      return;
    }
    const held = await db
      .update(siteOptions, { value })
      .where(and(name(), eq(db.table(siteOptions).value, row.value)) ?? name());
    if (held > 0) return;
    // The same value read twice, and still not the stored one: the reads
    // answer from a snapshot older than the writer that changed it.
    if (seen === row.value) {
      throw NextlyError.conflict({
        reason: "state",
        message:
          "This save raced another change to the page builder's components. Save it again.",
        logContext: { cause: GRAPH_SNAPSHOT_RACED },
      });
    }
    seen = row.value;
  }
}
