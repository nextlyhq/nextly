/**
 * A collection delete rule that answers a filter deletes only the entries the
 * filter matches.
 *
 * Asked as a signed-in user holding the read and delete permissions, so the
 * rule is what narrows the caller: an entry the filter matches is deleted, and
 * one it does not match is refused and left in place. The refusal is the
 * missing entry's 404 where the caller may not read the entry either, and a
 * 403 in words where it may.
 *
 * Through the Direct API and through a delete inside the caller's own
 * transaction, the way a plugin service deletes.
 *
 * @module domains/collections/__tests__/write-rule-filter-limits-deletes.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  grantTo,
  userWhoMay,
} from "../../../__tests__/fixtures/permission-holders";
import { clearRuleFilterReports } from "../../../auth/access/rule-answer";
import { defineCollection, text } from "../../../config";
import { NextlyError } from "../../../errors/nextly-error";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";

// Integration files share fixed system-table names, so this file keeps its
// own collection slugs.
const POSTS = "writefilter_posts";
// The same delete rule over a collection anyone signed in may read, so an
// entry outside the delete filter is one the caller can still see.
const OPEN_POSTS = "writefilter_open_posts";
// A read rule that answers a filter of its own, over a different field, so
// whether the caller may read an entry is decided by that entry's values.
const TEAM_POSTS = "writefilter_team_posts";

const AUTHOR = "writefilter-author";
const OTHER = "writefilter-other";

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
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: POSTS,
        access: { read: ownEntries, delete: ownEntries },
        fields: [text({ name: "title" }), text({ name: "owner" })],
      }),
      defineCollection({
        slug: OPEN_POSTS,
        access: { read: () => true, delete: ownEntries },
        fields: [text({ name: "title" }), text({ name: "owner" })],
      }),
      defineCollection({
        slug: TEAM_POSTS,
        access: {
          read: () => ({ team: { equals: "public" } }) as unknown as boolean,
          delete: ownEntries,
        },
        fields: [
          text({ name: "title" }),
          text({ name: "owner" }),
          text({ name: "team" }),
        ],
      }),
    ],
  });
  // A code rule only narrows a permission, so the author holds both.
  const all = [POSTS, OPEN_POSTS, TEAM_POSTS];
  await userWhoMay(current, AUTHOR, "read", all);
  await grantTo(current, AUTHOR, "delete", all);
  return current;
}

/** The author's own entry and another's, in `collection`. */
async function seed(
  t: TestNextly,
  collection: string
): Promise<{ own: string; others: string }> {
  const own = await t.nextly.create({
    collection,
    data: { title: "mine", owner: AUTHOR },
  });
  const others = await t.nextly.create({
    collection,
    data: { title: "theirs", owner: OTHER },
  });
  return { own: String(own.item.id), others: String(others.item.id) };
}

const asAuthor = {
  overrideAccess: false,
  user: { id: AUTHOR },
} as const;

/** The error a Direct API call threw, or `undefined` where it succeeded. */
async function errorOf(call: () => Promise<unknown>): Promise<NextlyError> {
  try {
    await call();
  } catch (error) {
    if (NextlyError.is(error)) return error;
    throw error;
  }
  throw new Error("the call succeeded");
}

async function stillThere(
  t: TestNextly,
  collection: string,
  id: string
): Promise<boolean> {
  const found = await t.nextly.find({
    collection,
    where: { id: { equals: id } },
  });
  return found.items.length === 1;
}

describe("a delete rule that answers a filter", () => {
  it("deletes an entry the filter matches", async () => {
    const t = await boot();
    const { own } = await seed(t, POSTS);

    await t.nextly.delete({ collection: POSTS, id: own, ...asAuthor });

    expect(await stillThere(t, POSTS, own)).toBe(false);
  });

  it("answers an entry outside the filter the caller may not read as missing, and leaves it", async () => {
    const t = await boot();
    const { others } = await seed(t, POSTS);

    const refused = await errorOf(() =>
      t.nextly.delete({ collection: POSTS, id: others, ...asAuthor })
    );
    const missing = await errorOf(() =>
      t.nextly.delete({
        collection: POSTS,
        id: "00000000-0000-4000-8000-000000000000",
        ...asAuthor,
      })
    );

    expect(refused.statusCode).toBe(404);
    expect(refused.code).toBe("NOT_FOUND");
    // The entry outside the filter reads exactly as one that does not exist.
    expect(refused.publicMessage).toBe(missing.publicMessage);
    expect(refused.publicData).toEqual(missing.publicData);
    expect(await stillThere(t, POSTS, others)).toBe(true);
  });

  it("refuses an entry outside the filter the caller may read with a 403, and leaves it", async () => {
    const t = await boot();
    const { others } = await seed(t, OPEN_POSTS);

    const refused = await errorOf(() =>
      t.nextly.delete({ collection: OPEN_POSTS, id: others, ...asAuthor })
    );

    expect(refused.statusCode).toBe(403);
    expect(refused.code).toBe("FORBIDDEN");
    expect(await stillThere(t, OPEN_POSTS, others)).toBe(true);
  });

  it("asks whether the caller may read the entry itself, by the read rule's filter", async () => {
    // The read rule's filter decides per entry: another's entry in the public
    // team is one the author can see, so its refusal is a 403, and another's in
    // a team the read filter withholds is answered as missing.
    const t = await boot();
    const seen = await t.nextly.create({
      collection: TEAM_POSTS,
      data: { title: "theirs, public", owner: OTHER, team: "public" },
    });
    const unseen = await t.nextly.create({
      collection: TEAM_POSTS,
      data: { title: "theirs, staff", owner: OTHER, team: "staff" },
    });

    const readable = await errorOf(() =>
      t.nextly.delete({
        collection: TEAM_POSTS,
        id: String(seen.item.id),
        ...asAuthor,
      })
    );
    const unreadable = await errorOf(() =>
      t.nextly.delete({
        collection: TEAM_POSTS,
        id: String(unseen.item.id),
        ...asAuthor,
      })
    );

    expect(readable.statusCode).toBe(403);
    expect(unreadable.statusCode).toBe(404);
    expect(await stillThere(t, TEAM_POSTS, String(seen.item.id))).toBe(true);
    expect(await stillThere(t, TEAM_POSTS, String(unseen.item.id))).toBe(true);
  });

  it("limits a delete inside the caller's transaction to the matching entries", async () => {
    const t = await boot();
    const { own, others } = await seed(t, OPEN_POSTS);
    const entries = t
      .getService("collectionsHandler")
      .getEntryService() as CollectionEntryService;
    type Deleted = Awaited<
      ReturnType<CollectionEntryService["deleteEntryInTransaction"]>
    >;

    const deletedOwn = await t.adapter.transaction<Deleted>(tx =>
      entries.deleteEntryInTransaction(tx, {
        collectionName: OPEN_POSTS,
        entryId: own,
        user: { id: AUTHOR },
      })
    );
    const refusal = await t.adapter
      .transaction<Deleted>(tx =>
        entries.deleteEntryInTransaction(tx, {
          collectionName: OPEN_POSTS,
          entryId: others,
          user: { id: AUTHOR },
        })
      )
      .then(
        (result): { result?: Deleted; error?: unknown } => ({ result }),
        (error: unknown): { result?: Deleted; error?: unknown } => ({ error })
      );

    expect(deletedOwn.success).toBe(true);
    expect(await stillThere(t, OPEN_POSTS, own)).toBe(false);
    // Refused either way it reaches the caller: a returned failure or a
    // thrown one, each a 403 for an entry the caller may read.
    const status =
      refusal.result?.statusCode ??
      (NextlyError.is(refusal.error) ? refusal.error.statusCode : undefined);
    expect(refusal.result?.success ?? false).toBe(false);
    expect(status).toBe(403);
    expect(await stillThere(t, OPEN_POSTS, others)).toBe(true);
  });
});
