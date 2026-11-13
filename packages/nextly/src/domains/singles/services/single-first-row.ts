/**
 * A Single's stored document, read by the transaction that would create it.
 *
 * A Single holds at most one document, created by its first read (from its
 * defaults) or its first write. Two requests arriving together on a fresh
 * site each find no row before their transactions open, and each goes on to
 * create it. Read plainly inside the transaction, the row the other request
 * is inserting is invisible until it commits, so both insert, and the
 * table's unique slug refuses the second: on PostgreSQL the refusal aborts
 * the whole transaction, so the request fails, however it is caught.
 *
 * So every creation reads the row here, under locks, and inserts only when
 * this read finds none. The Single's registry row is locked first: it always
 * exists, so the lock is on that one record, and two creations of one Single
 * run one after the other. The second then finds the row the first inserted,
 * rather than both locking the empty table's gap and deadlocking on MySQL,
 * or both inserting on PostgreSQL, where a lock on no row holds nothing. The
 * order, registry row then the document's row, is the one every history
 * write and deletion takes (`history-locks`).
 *
 * The document's row is read by a locking read as well. On MySQL a
 * transaction's first plain read fixes the snapshot every later plain read
 * answers from; a locking read reads the latest committed row and fixes no
 * snapshot, so one taken after it is taken under the lock. On PostgreSQL each
 * statement sees what committed before it, and SQLite runs one writing
 * transaction at a time, so there the locks cost nothing.
 *
 * Paid only by a creation, which happens once in a Single's life.
 *
 * @module domains/singles/services/single-first-row
 */

import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { NextlyError } from "../../../errors/nextly-error";
import { REGISTRY_TABLES } from "../../versions/history-locks";

/**
 * The Single's stored document, read under its creation lock on `tx`, or
 * `undefined` when there is none and `tx` is the one to create it.
 *
 * @param tx - The transaction that inserts the document when none is found
 * @param single - The Single's registry id and its table
 */
export async function readSingleForCreation<T>(
  tx: Pick<TransactionContext, "select">,
  single: { readonly id: string; readonly tableName: string }
): Promise<T | undefined> {
  // Where Singles are registered, from the one map every history lock reads.
  const registry = REGISTRY_TABLES.single;
  if (registry === undefined) {
    throw NextlyError.internal({
      logContext: { reason: "single-registry-table-unknown" },
    });
  }
  await tx.select(registry, {
    columns: ["id"],
    where: { and: [{ column: "id", op: "=", value: single.id }] },
    limit: 1,
    forUpdate: true,
  });
  const [row] = await tx.select<T>(single.tableName, {
    limit: 1,
    forUpdate: true,
  });
  return row;
}
