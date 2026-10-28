/**
 * Bulk and batch writes under update and delete rules that answer a filter:
 * each changes only the entries the filter matches, and counts only those.
 *
 * By ids, each entry is judged on its own: one outside the filter is a failed
 * item (not found where the caller may not read it, forbidden where it may),
 * and the rest are written. By query, the entries matched are only those the
 * filter matches, so an entry outside it is neither written nor named. A batch
 * in one transaction writes each entry the filter matches and fails the others
 * as items; one that would move an entry out of the filter refuses the whole
 * batch, with nothing changed.
 *
 * @module domains/collections/__tests__/write-rule-filter-limits-bulk.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { clearRuleFilterReports } from "../../../auth/access/rule-answer";
import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";

// Integration files share fixed system-table names, so this file keeps its
// own collection slugs.
/** Its read rule is the same filter, so another's entry is not readable. */
const POSTS = "bulkfilter_posts";
/** Anyone signed in may read it, so another's entry is readable. */
const OPEN_POSTS = "bulkfilter_open_posts";

const AUTHOR = "bulkfilter-author";
const OTHER = "bulkfilter-other";

/** "Only the caller's own": a filter over the entry's `owner`. */
const ownEntries = ({ user }: { user: { id: string } | null }) =>
  ({ owner: { equals: user?.id ?? "" } }) as unknown as boolean;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
  clearRuleFilterReports();
});

async function boot(): Promise<TestNextly> {
  const writes = { update: ownEntries, delete: ownEntries };
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: POSTS,
        access: { read: ownEntries, ...writes },
        fields: [text({ name: "title" }), text({ name: "owner" })],
      }),
      defineCollection({
        slug: OPEN_POSTS,
        access: { read: () => true, ...writes },
        fields: [text({ name: "title" }), text({ name: "owner" })],
      }),
    ],
  });
  // A code rule only narrows a permission, so the author holds each one.
  const both = [POSTS, OPEN_POSTS];
  await userWhoMay(current, AUTHOR, "read", both);
  for (const action of ["update", "delete"]) {
    await grantTo(current, AUTHOR, action, both);
  }
  return current;
}

/** Two of the author's entries and one of another's, in `collection`. */
async function seed(
  t: TestNextly,
  collection: string
): Promise<{ own: string; ownToo: string; others: string }> {
  const make = async (title: string, owner: string) =>
    String(
      (await t.nextly.create({ collection, data: { title, owner } })).item.id
    );
  return {
    own: await make("mine", AUTHOR),
    ownToo: await make("mine too", AUTHOR),
    others: await make("theirs", OTHER),
  };
}

const entriesOf = (t: TestNextly) =>
  t
    .getService("collectionsHandler")
    .getEntryService() as CollectionEntryService;

const asAuthor = { user: { id: AUTHOR }, overrideAccess: false } as const;

/** The stored row of `id`, read past every access check. */
async function stored(
  t: TestNextly,
  collection: string,
  id: string
): Promise<Record<string, unknown> | undefined> {
  const rows = await t.adapter.select<Record<string, unknown>>(
    `dc_${collection}`,
    {}
  );
  return rows.find(row => String(row.id) === id);
}

/** Every one of the seeded entries' titles. */
const ALL = { title: { in: ["mine", "mine too", "theirs"] } };

describe("a bulk write by query", () => {
  it("updates only the entries the filter matches, and counts them", async () => {
    const t = await boot();
    const { own, ownToo, others } = await seed(t, OPEN_POSTS);
    const result = await entriesOf(t).bulkUpdateByQuery({
      collectionName: OPEN_POSTS,
      where: ALL,
      data: { title: "renamed" },
      ...asAuthor,
    } as never);

    expect(result).toMatchObject({ successCount: 2, failedCount: 0 });
    expect((await stored(t, OPEN_POSTS, own))?.title).toBe("renamed");
    expect((await stored(t, OPEN_POSTS, ownToo))?.title).toBe("renamed");
    // Outside the filter: not written, and not named.
    expect((await stored(t, OPEN_POSTS, others))?.title).toBe("theirs");
    expect(JSON.stringify(result)).not.toContain(others);
  });

  it("deletes only the entries the filter matches, and counts them", async () => {
    const t = await boot();
    const { own, ownToo, others } = await seed(t, POSTS);
    const result = await entriesOf(t).bulkDeleteByQuery({
      collectionName: POSTS,
      where: ALL,
      ...asAuthor,
    } as never);

    expect(result).toMatchObject({ successCount: 2, failedCount: 0 });
    expect(await stored(t, POSTS, own)).toBeUndefined();
    expect(await stored(t, POSTS, ownToo)).toBeUndefined();
    expect(await stored(t, POSTS, others)).toBeDefined();
    expect(JSON.stringify(result)).not.toContain(others);
  });
});

describe("a bulk write by ids", () => {
  it("writes the entries the filter matches and fails the rest by what the caller may read", async () => {
    const t = await boot();
    const hidden = await seed(t, POSTS);
    const open = await seed(t, OPEN_POSTS);
    const write = (collection: string, ids: string[]) =>
      entriesOf(t).bulkUpdateEntries({
        collectionName: collection,
        ids,
        data: { title: "renamed" },
        ...asAuthor,
      } as never);

    const unreadable = await write(POSTS, [hidden.own, hidden.others]);
    expect(unreadable).toMatchObject({ successCount: 1, failedCount: 1 });
    // Another's entry the author may not read reads as missing.
    expect(unreadable.failures).toEqual([
      expect.objectContaining({ id: hidden.others, code: "NOT_FOUND" }),
    ]);

    const readable = await write(OPEN_POSTS, [open.own, open.others]);
    expect(readable.failures).toEqual([
      expect.objectContaining({ id: open.others, code: "FORBIDDEN" }),
    ]);
    expect((await stored(t, OPEN_POSTS, open.others))?.title).toBe("theirs");
  });

  it("refuses an entry the write would move out of the filter, and keeps it", async () => {
    const t = await boot();
    const { own } = await seed(t, OPEN_POSTS);
    const result = await entriesOf(t).bulkUpdateEntries({
      collectionName: OPEN_POSTS,
      ids: [own],
      data: { owner: OTHER },
      ...asAuthor,
    } as never);

    expect(result).toMatchObject({ successCount: 0, failedCount: 1 });
    expect((await stored(t, OPEN_POSTS, own))?.owner).toBe(AUTHOR);
  });

  it("deletes the entries the filter matches and fails the rest", async () => {
    const t = await boot();
    const { own, others } = await seed(t, OPEN_POSTS);
    const result = await entriesOf(t).bulkDeleteEntries({
      collectionName: OPEN_POSTS,
      ids: [own, others],
      ...asAuthor,
    } as never);

    expect(result).toMatchObject({ successCount: 1, failedCount: 1 });
    expect(await stored(t, OPEN_POSTS, own)).toBeUndefined();
    expect(await stored(t, OPEN_POSTS, others)).toBeDefined();
  });
});

describe("a batch in one transaction", () => {
  it("updates the entries the filter matches and fails the rest as items", async () => {
    const t = await boot();
    const { own, others } = await seed(t, OPEN_POSTS);
    const result = await entriesOf(t).updateEntries(
      { collectionName: OPEN_POSTS, ...asAuthor } as never,
      [
        { id: own, data: { title: "renamed" } },
        { id: others, data: { title: "renamed" } },
      ]
    );

    expect(result).toMatchObject({ successful: 1, failed: 1 });
    expect((await stored(t, OPEN_POSTS, own))?.title).toBe("renamed");
    expect((await stored(t, OPEN_POSTS, others))?.title).toBe("theirs");
  });

  it("refuses the whole batch when a write would move an entry out of the filter", async () => {
    const t = await boot();
    const { own, ownToo } = await seed(t, OPEN_POSTS);
    const result = await entriesOf(t).updateEntries(
      { collectionName: OPEN_POSTS, ...asAuthor } as never,
      [
        { id: ownToo, data: { title: "renamed" } },
        { id: own, data: { owner: OTHER } },
      ]
    );

    expect(result).toMatchObject({ successful: 0 });
    // Nothing changed, the entry written before the move-out included.
    expect((await stored(t, OPEN_POSTS, own))?.owner).toBe(AUTHOR);
    expect((await stored(t, OPEN_POSTS, ownToo))?.title).toBe("mine too");
  });

  it("deletes the entries the filter matches and fails the rest as items", async () => {
    const t = await boot();
    const { own, others } = await seed(t, OPEN_POSTS);
    const result = await entriesOf(t).deleteEntries(
      { collectionName: OPEN_POSTS, user: { id: AUTHOR } } as never,
      [own, others]
    );

    expect(result).toMatchObject({ successful: 1, failed: 1 });
    expect(await stored(t, OPEN_POSTS, own)).toBeUndefined();
    expect(await stored(t, OPEN_POSTS, others)).toBeDefined();
  });
});
