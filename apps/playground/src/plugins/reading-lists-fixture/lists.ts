/**
 * What the reading-lists fixture does with its tables, written against
 * `ctx.db` so each step is typed from the declarations in `schema.ts`.
 *
 * Every write that changes which lists hold a post also recounts that post's
 * hidden `savedCount`, in the same transaction, so the count never disagrees
 * with the rows it counts. The plugin's install hook calls the same recount
 * for every post, so one function owns the number.
 */
import { and, eq } from "@nextlyhq/plugin-sdk/db";
import type {
  InferRow,
  PluginDatabase,
  PluginTransaction,
} from "@nextlyhq/plugin-sdk/schema";

import { listItems, lists, POSTS_TABLE, postColumns, PREFIX } from "./schema";

export type ReadingList = InferRow<typeof lists>;
export type ReadingListItem = InferRow<typeof listItems>;

/** Start an empty list for a user. */
export function createList(
  db: PluginDatabase,
  ownerId: string,
  name: string
): Promise<ReadingList> {
  return db.insertReturning(lists, { ownerId, name });
}

/**
 * Save a post to a list and recount the post. Saving a post a list already
 * holds is refused by the table's unique index on `(listId, postId)`.
 */
export function savePost(
  db: PluginDatabase,
  listId: string,
  postId: string
): Promise<void> {
  return db.transaction(async tx => {
    await tx.insert(listItems, { listId, postId });
    await recountPost(tx, postId);
  });
}

/** Take a post off a list and recount the post. */
export function removePost(
  db: PluginDatabase,
  listId: string,
  postId: string
): Promise<void> {
  return db.transaction(async tx => {
    const item = tx.table(listItems);
    await tx
      .delete(listItems)
      .where(and(eq(item.listId, listId), eq(item.postId, postId)));
    await recountPost(tx, postId);
  });
}

/**
 * A list with its items, read through the `items` relation in one query, or
 * `null` when there is no such list.
 */
export async function readList(
  db: PluginDatabase,
  listId: string
): Promise<(ReadingList & { items: ReadingListItem[] }) | null> {
  // Relational queries are keyed by the table's full name.
  const query = db.query[`${PREFIX}__lists`];
  if (!query) return null;
  const found = await query.findFirst({
    where: { id: listId },
    with: { items: true },
  });
  return (
    (found as (ReadingList & { items: ReadingListItem[] }) | undefined) ?? null
  );
}

/** How many lists hold a post, as its hidden column records it. */
export async function savedCount(
  db: PluginDatabase,
  postId: string
): Promise<number | null> {
  const row = await db.contributed(POSTS_TABLE, postColumns).get(postId);
  return row?.savedCount ?? null;
}

/**
 * Set a post's hidden `savedCount` to the number of lists holding it. A post
 * that no longer exists changes nothing, since `set` matches no row.
 */
export async function recountPost(
  db: PluginTransaction,
  postId: string
): Promise<void> {
  const held = await db
    .select(listItems)
    .where(eq(db.table(listItems).postId, postId))
    .count();
  await db.contributed(POSTS_TABLE, postColumns).set(postId, {
    savedCount: held,
  });
}

/**
 * Recount every post a list holds. Safe to run any number of times, which is
 * what an install hook needs: a reinstall after `--keep-data` finds the items
 * kept and puts each count back in step with them.
 */
export function recountAll(db: PluginDatabase): Promise<void> {
  return db.transaction(async tx => {
    const items = await tx.select(listItems).all();
    for (const postId of new Set(items.map(item => item.postId))) {
      await recountPost(tx, postId);
    }
  });
}
