import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

/**
 * Lock media rows for the rest of `tx`, one row at a time in ascending id
 * order (JavaScript's string order): the one order every path that locks
 * several items takes (a delete that can be undone, its Undo, a folder
 * delete), so two of them over overlapping items take turns rather than each
 * holding a row the other waits for.
 *
 * One `lockRow` per id rather than one `IN (...) FOR UPDATE`: the order such a
 * statement locks in is the plan's (heap order on a PostgreSQL bitmap or
 * sequential scan), not the order of its values, so it cannot promise this
 * one. A row that does not exist locks nothing. SQLite has no row locks; its
 * write transactions already run one at a time.
 */
export async function lockMediaItems(
  tx: Pick<TransactionContext, "lockRow">,
  ids: readonly string[]
): Promise<void> {
  for (const id of [...new Set(ids)].sort()) await tx.lockRow("media", id);
}
