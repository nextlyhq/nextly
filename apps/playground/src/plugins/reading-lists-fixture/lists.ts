/**
 * What the reading-lists fixture does with its tables, written against
 * `ctx.db` so each step is typed from the declarations in `schema.ts`.
 */
import { and, eq } from "@nextlyhq/plugin-sdk/db";
import type { InferRow, PluginDatabase } from "@nextlyhq/plugin-sdk/schema";

import { listItems, lists, POSTS_TABLE, postColumns, PREFIX } from "./schema";

type ReadingList = InferRow<typeof lists>;
type ReadingListItem = InferRow<typeof listItems>;

/** Start an empty list for a user. */
export function createList(
  db: PluginDatabase,
  ownerId: string,
  name: string
): Promise<ReadingList> {
  return db.insertReturning(lists, { ownerId, name });
}

/**
 * Save a post to a list, and record on the post when it was saved. Saving a
 * post a list already holds is refused by the table's unique index on
 * `(listId, postId)`, and then nothing is recorded.
 */
export function savePost(
  db: PluginDatabase,
  listId: string,
  postId: string
): Promise<void> {
  return db.transaction(async tx => {
    await tx.insert(listItems, { listId, postId });
    await tx
      .contributed(POSTS_TABLE, postColumns)
      .set(postId, { lastSavedAt: new Date() });
  });
}

/** Take a post off a list. The post keeps when it was last saved. */
export async function removePost(
  db: PluginDatabase,
  listId: string,
  postId: string
): Promise<void> {
  const item = db.table(listItems);
  // `and` is undefined only when given no condition, never here.
  const saved = and(eq(item.listId, listId), eq(item.postId, postId));
  if (saved) await db.delete(listItems).where(saved);
}

/**
 * A list with its items, read through the `items` relation in one query, or
 * `null` when there is no such list. Relational queries are keyed by the
 * table's full name, and their rows are not typed yet, so the row is cast to
 * the shape the relation reads.
 */
export async function readList(
  db: PluginDatabase,
  listId: string
): Promise<(ReadingList & { items: ReadingListItem[] }) | null> {
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

/** When a post was last saved, as its hidden column records it. */
export async function lastSavedAt(
  db: PluginDatabase,
  postId: string
): Promise<Date | null> {
  const row = await db.contributed(POSTS_TABLE, postColumns).get(postId);
  return row?.lastSavedAt ?? null;
}

/**
 * Fill in when each saved post was last saved, from its newest item, where the
 * post records no time. Safe to run any number of times, which is what an
 * install hook needs: it writes only what is missing, and what it writes is
 * read from the items.
 */
export function backfillLastSaved(db: PluginDatabase): Promise<void> {
  return db.transaction(async tx => {
    const newest = new Map<string, Date>();
    for (const item of await tx.select(listItems).all()) {
      const known = newest.get(item.postId);
      if (!known || item.createdAt > known) {
        newest.set(item.postId, item.createdAt);
      }
    }
    const posts = tx.contributed(POSTS_TABLE, postColumns);
    for (const row of await posts.getMany([...newest.keys()])) {
      const savedAt = newest.get(String(row.id));
      if (row.lastSavedAt === null && savedAt) {
        await posts.set(row.id, { lastSavedAt: savedAt });
      }
    }
  });
}
