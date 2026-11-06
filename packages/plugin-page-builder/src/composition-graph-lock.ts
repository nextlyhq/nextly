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
 * A row of a table the plugin already has rather than a table of its own, so
 * the lock needs no migration. The row lock is the dialect's own and lasts
 * exactly as long as the transaction: an `UPDATE` of the row on PostgreSQL
 * and MySQL, which locks it until commit or rollback. SQLite takes no row
 * lock and needs none: its transactions open with `BEGIN IMMEDIATE`, which
 * already lets one writer in at a time.
 *
 * The row is written whenever it is locked, with a fresh value each time, so
 * MySQL, which counts the rows an update changed rather than the ones it
 * matched, still answers that one was locked.
 *
 * @module composition-graph-lock
 */
import { eq } from "@nextlyhq/plugin-sdk/db";
import {
  isUniqueViolation,
  type PluginDatabase,
  type PluginTransaction,
} from "@nextlyhq/plugin-sdk/schema";

import { siteOptions } from "./schema/tables";

/** The lock row's name in the table. */
const COMPOSITION_GRAPH_LOCK = "composition-graph-lock";

/** The dialect, as `ctx.dialect` names it. */
type Dialect = Parameters<typeof isUniqueViolation>[0];

/**
 * Lock the composition graph for the rest of `db`'s transaction: the write's
 * own, as an in-transaction handler is handed it.
 *
 * Where the row is not there yet (the start-up step below has not run, or
 * failed), it is inserted, which locks it as well. Two first writes inserting
 * it at once meet the unique index on `name`, and the one that loses fails
 * rather than going on unlocked.
 */
export async function holdCompositionGraph(
  db: Pick<PluginTransaction, "update" | "insert" | "table">,
  dialect: Dialect
): Promise<void> {
  if (dialect === "sqlite") return;
  const value = globalThis.crypto.randomUUID();
  const held = await db
    .update(siteOptions, { value })
    .where(eq(db.table(siteOptions).name, COMPOSITION_GRAPH_LOCK));
  if (held > 0) return;
  await db.insert(siteOptions, { name: COMPOSITION_GRAPH_LOCK, value });
}

/**
 * Put the lock row in place, if it is not there yet, so a write never has to
 * insert it. Run once at start, on the plugin's own connection; a row another
 * instance put there first is the row.
 */
export async function seedCompositionGraphLock(
  db: Pick<PluginDatabase, "insert">,
  dialect: Dialect
): Promise<void> {
  if (dialect === "sqlite") return;
  try {
    await db.insert(siteOptions, {
      name: COMPOSITION_GRAPH_LOCK,
      value: globalThis.crypto.randomUUID(),
    });
  } catch (error) {
    if (!isUniqueViolation(dialect, error)) throw error;
  }
}
