import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

/**
 * The one order media rows and folder rows are locked in, by every write
 * that takes more than one of them: FOLDERS FIRST, THEN MEDIA, each in
 * ascending id order (JavaScript's string order).
 *
 * - A folder delete locks its folders (`lockMediaFolders`), then the media
 *   they hold (`lockMediaItems`).
 * - A move into a folder locks the destination folder, then the item, before
 *   it writes `folder_id`: the write's foreign-key check locks the folder row
 *   too, and taken after the item it would meet a folder delete holding that
 *   folder and waiting for the item.
 * - A delete that can be undone, and its Undo, lock only media.
 *
 * So two of them over the same rows take turns rather than each holding a
 * row the other waits for. Each lock is one `lockRow`, never one
 * `IN (...) FOR UPDATE`: the order such a statement locks in is the plan's
 * (heap order on a PostgreSQL bitmap or sequential scan), not the order of
 * its values. A row that does not exist locks nothing. SQLite has no row
 * locks; its write transactions already run one at a time.
 */

/** Lock media rows for the rest of `tx`, in ascending id order. */
export async function lockMediaItems(
  tx: Pick<TransactionContext, "lockRow">,
  ids: readonly string[]
): Promise<void> {
  await lockInOrder(tx, "media", ids);
}

/** Lock media folder rows for the rest of `tx`, in ascending id order. */
export async function lockMediaFolders(
  tx: Pick<TransactionContext, "lockRow">,
  ids: readonly string[]
): Promise<void> {
  await lockInOrder(tx, "media_folders", ids);
}

async function lockInOrder(
  tx: Pick<TransactionContext, "lockRow">,
  table: "media" | "media_folders",
  ids: readonly string[]
): Promise<void> {
  for (const id of [...new Set(ids)].sort()) await tx.lockRow(table, id);
}
