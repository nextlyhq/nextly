import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

/**
 * The one order media rows and folder rows are locked in, by every write
 * that takes more than one of them: THE FOLDER TREE, THEN FOLDERS, THEN
 * MEDIA, folders and media each in ascending id order (JavaScript's string
 * order).
 *
 * - A change to the folder hierarchy (a folder deleted, a folder moved
 *   under another) runs in `inFolderTreeTransaction`, which takes the one
 *   tree-wide lock first, so no two of them run at once: folder moves and
 *   deletes are rare, and serialising them is what keeps a move from
 *   locking two folders of a subtree in the other order from a delete.
 *   It then locks folders (`lockMediaFolders`), then media
 *   (`lockMediaItems`).
 * - A move of an item into a folder locks the destination folder, then the
 *   item, before it writes `folder_id`: the write's foreign-key check locks
 *   the folder row too, and taken after the item it would meet a folder
 *   delete holding that folder and waiting for the item. It takes no tree
 *   lock: it never holds a folder a hierarchy change waits for while
 *   waiting for one itself.
 * - An upload or a folder created into a folder holds no row a hierarchy
 *   change waits for; its foreign-key check waits for the folder's lock.
 * - A delete that can be undone, and its Undo, lock only media.
 *
 * So two of them over the same rows take turns rather than each holding a
 * row the other waits for. Each row lock is one `lockRow`, never one
 * `IN (...) FOR UPDATE`: the order such a statement locks in is the plan's
 * (heap order on a PostgreSQL bitmap or sequential scan), not the order of
 * its values. A row that does not exist locks nothing. SQLite has no row
 * locks; its write transactions already run one at a time.
 */

/** The `nextly_meta` row a change to the folder hierarchy locks first. */
const FOLDER_TREE_LOCK_KEY = "media.folders.tree";

const FOLDER_TREE_LOCK: {
  and: Array<{ column: string; op: "="; value: string }>;
} = { and: [{ column: "key", op: "=", value: FOLDER_TREE_LOCK_KEY }] };

/**
 * Run `work` in a transaction holding the folder tree's lock, taken before
 * anything else. Read committed on every dialect, so each statement reads
 * what is committed when it runs, on MySQL as on PostgreSQL, rather than a
 * snapshot fixed before a lock was waited for.
 *
 * The lock's row is created once, outside the transaction and keeping any
 * row already there, so two first changes never race to create it inside
 * one; it is never removed.
 */
export async function inFolderTreeTransaction<T>(
  db: Pick<DrizzleAdapter, "select" | "upsert" | "transaction">,
  work: (tx: TransactionContext) => Promise<T>
): Promise<T> {
  const [present] = await db.select("nextly_meta", {
    columns: ["key"],
    where: FOLDER_TREE_LOCK,
  });
  if (!present) {
    await db.upsert(
      "nextly_meta",
      { key: FOLDER_TREE_LOCK_KEY, value: "{}", updatedAt: new Date() },
      { conflictColumns: ["key"], updateColumns: [] }
    );
  }
  return db.transaction(
    async tx => {
      await tx.select("nextly_meta", {
        columns: ["key"],
        where: FOLDER_TREE_LOCK,
        forUpdate: true,
      });
      return work(tx);
    },
    { isolationLevel: "read committed" }
  );
}

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
