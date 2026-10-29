/**
 * A collection's update, publish and unpublish rules that answer a filter
 * change only the entries the filter matches, and an update may not move an
 * entry out of it.
 *
 * Asked as a signed-in user holding the permissions, through the Direct API
 * and through an update inside the caller's own transaction, the way a plugin
 * service writes, so the rule is what narrows the caller. An entry outside the
 * filter is refused and left as it was: the missing entry's 404 where the
 * caller may not read it either, and a 403 in words where it may.
 *
 * A write that changes the entry's data must leave it inside every filter that
 * judged the write. An edit reassigning the author's own post to someone else
 * is refused with nothing changed, and so is a publish that would promote a
 * held draft carrying such an edit.
 *
 * @module domains/collections/__tests__/write-rule-filter-limits-updates.integration.test
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
const POSTS = "updfilter_posts";
// The same write rules over a collection anyone signed in may read, so an
// entry outside the filter is one the caller can still see.
const OPEN_POSTS = "updfilter_open_posts";
// Published entries whose edits are held as a pending change.
const DRAFTED = "updfilter_drafted";
// Anyone signed in may publish, only its owner edit; a hook turns a publish
// into an edit.
const HOOKED = "updfilter_hooked";
/** The title the hook sets on a publish. */
const SET_BY_A_HOOK = "set by a hook";

const AUTHOR = "updfilter-author";
const OTHER = "updfilter-other";

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
  const writes = {
    update: ownEntries,
    publish: ownEntries,
    unpublish: ownEntries,
  };
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: POSTS,
        status: true,
        access: { read: ownEntries, ...writes },
        fields: [text({ name: "title" }), text({ name: "owner" })],
      }),
      defineCollection({
        slug: OPEN_POSTS,
        status: true,
        access: { read: () => true, ...writes },
        fields: [text({ name: "title" }), text({ name: "owner" })],
      }),
      defineCollection({
        slug: DRAFTED,
        status: true,
        versions: { drafts: true },
        access: { read: () => true, ...writes },
        fields: [text({ name: "title" }), text({ name: "owner" })],
      }),
      defineCollection({
        slug: HOOKED,
        status: true,
        access: { read: () => true, update: ownEntries, publish: () => true },
        hooks: {
          beforeChange: [
            context => {
              const data = context.data as Record<string, unknown>;
              if (context.operation === "update" && data.status) {
                data.title = SET_BY_A_HOOK;
              }
              return data;
            },
          ],
        },
        fields: [text({ name: "title" }), text({ name: "owner" })],
      }),
    ],
  });
  // A code rule only narrows a permission, so the author holds each one.
  const all = [POSTS, OPEN_POSTS, DRAFTED, HOOKED];
  await userWhoMay(current, AUTHOR, "read", all);
  for (const action of ["update", "publish", "unpublish"]) {
    await grantTo(current, AUTHOR, action, all);
  }
  return current;
}

/** The author's own draft entry and another's, in `collection`. */
async function seed(
  t: TestNextly,
  collection: string,
  status = "draft"
): Promise<{ own: string; others: string }> {
  const own = await t.nextly.create({
    collection,
    data: { title: "mine", owner: AUTHOR, status },
  });
  const others = await t.nextly.create({
    collection,
    data: { title: "theirs", owner: OTHER, status },
  });
  return { own: String(own.item.id), others: String(others.item.id) };
}

const asAuthor = { overrideAccess: false, user: { id: AUTHOR } } as const;

/** The error a Direct API call threw. */
async function errorOf(call: () => Promise<unknown>): Promise<NextlyError> {
  try {
    await call();
  } catch (error) {
    if (NextlyError.is(error)) return error;
    throw error;
  }
  throw new Error("the call succeeded");
}

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

const update = (
  t: TestNextly,
  collection: string,
  id: string,
  data: Record<string, unknown>
) => t.nextly.update({ collection, id, data, ...asAuthor } as never);

/** The entry as the author reads it with its held edit, where it has one. */
const readWithDraft = (t: TestNextly, collection: string, id: string) =>
  t.nextly.findByID({
    collection,
    id,
    draft: true,
    ...asAuthor,
  } as never) as Promise<{ title?: string; owner?: string } | null>;

type Updated = Awaited<
  ReturnType<CollectionEntryService["updateEntryInTransaction"]>
>;
type Settled = { result?: Updated; error?: unknown };

/**
 * An update inside the caller's own transaction, the way a plugin service
 * writes, settled as its result or its error. An `OPEN_POSTS` entry unless
 * `collectionName` names another.
 */
const updateInTransaction = (
  t: TestNextly,
  entryId: string,
  data: Record<string, unknown>,
  collectionName = OPEN_POSTS
): Promise<Settled> => {
  const entries = t
    .getService("collectionsHandler")
    .getEntryService() as CollectionEntryService;
  return t.adapter
    .transaction<Updated>(tx =>
      entries.updateEntryInTransaction(
        tx,
        { collectionName, entryId, user: { id: AUTHOR } },
        data
      )
    )
    .then(
      (result): Settled => ({ result }),
      (error: unknown): Settled => ({ error })
    );
};

/**
 * The status a refusal reached the caller with, either way it can: a
 * returned failure or a thrown one.
 */
const statusOf = (settled: Settled): number | undefined =>
  settled.result?.statusCode ??
  (NextlyError.is(settled.error) ? settled.error.statusCode : undefined);

describe("an update rule that answers a filter", () => {
  it("changes an entry the filter matches", async () => {
    const t = await boot();
    const { own } = await seed(t, POSTS);

    await update(t, POSTS, own, { title: "renamed" });

    expect((await stored(t, POSTS, own))?.title).toBe("renamed");
  });

  it("answers an entry outside the filter the caller may not read as missing, and leaves it", async () => {
    const t = await boot();
    const { others } = await seed(t, POSTS);
    const before = await stored(t, POSTS, others);

    const refused = await errorOf(() =>
      update(t, POSTS, others, { title: "renamed" })
    );

    expect(refused.statusCode).toBe(404);
    expect(refused.code).toBe("NOT_FOUND");
    expect(await stored(t, POSTS, others)).toEqual(before);
  });

  it("refuses an entry outside the filter the caller may read with a 403, and leaves it", async () => {
    const t = await boot();
    const { others } = await seed(t, OPEN_POSTS);
    const before = await stored(t, OPEN_POSTS, others);

    const refused = await errorOf(() =>
      update(t, OPEN_POSTS, others, { title: "renamed" })
    );

    expect(refused.statusCode).toBe(403);
    expect(await stored(t, OPEN_POSTS, others)).toEqual(before);
  });

  it("refuses an update that would move the entry out of the filter, changing nothing", async () => {
    // The author's own post, handed to someone else: inside the filter before
    // the write and outside it after, so the write is refused and the post
    // stays the author's.
    const t = await boot();
    const { own } = await seed(t, OPEN_POSTS);
    const before = await stored(t, OPEN_POSTS, own);

    const refused = await errorOf(() =>
      update(t, OPEN_POSTS, own, { title: "given away", owner: OTHER })
    );

    expect(refused.statusCode).toBe(403);
    expect(await stored(t, OPEN_POSTS, own)).toEqual(before);
  });

  it("limits an update inside the caller's transaction to the matching entries", async () => {
    const t = await boot();
    const { own, others } = await seed(t, OPEN_POSTS);
    const othersBefore = await stored(t, OPEN_POSTS, others);

    const changed = await updateInTransaction(t, own, { title: "renamed" });
    const refused = await updateInTransaction(t, others, { title: "renamed" });

    expect(changed.result?.success).toBe(true);
    expect((await stored(t, OPEN_POSTS, own))?.title).toBe("renamed");
    expect(refused.result?.success ?? false).toBe(false);
    expect(statusOf(refused)).toBe(403);
    expect(await stored(t, OPEN_POSTS, others)).toEqual(othersBefore);
  });

  it("refuses an update inside the caller's transaction that would move the entry out of the filter", async () => {
    // Matched after the write, inside the same transaction: the author's own
    // post handed to someone else is refused and the transaction undone.
    const t = await boot();
    const { own } = await seed(t, OPEN_POSTS);
    const before = await stored(t, OPEN_POSTS, own);

    const refused = await updateInTransaction(t, own, {
      title: "given away",
      owner: OTHER,
    });

    expect(refused.result?.success ?? false).toBe(false);
    expect(statusOf(refused)).toBe(403);
    expect(await stored(t, OPEN_POSTS, own)).toEqual(before);
  });
});

describe("a publish a hook turns into an edit", () => {
  // Judged by the publish rule, which lets anyone publish; the hook names a
  // field, so the write is an edit, and the update rule's filter limits it.
  it("is allowed on an entry the update filter matches, and refused on another's", async () => {
    const t = await boot();
    const { own, others } = await seed(t, HOOKED);
    const before = await stored(t, HOOKED, others);

    await update(t, HOOKED, own, { status: "published" });
    const refused = await errorOf(() =>
      update(t, HOOKED, others, { status: "published" })
    );

    expect((await stored(t, HOOKED, own))?.title).toBe(SET_BY_A_HOOK);
    expect(refused.statusCode).toBe(403);
    expect(await stored(t, HOOKED, others)).toEqual(before);
  });

  it("is allowed on an entry the update filter matches inside the caller's transaction, and refused on another's", async () => {
    const t = await boot();
    const { own, others } = await seed(t, HOOKED);
    const before = await stored(t, HOOKED, others);

    const written = await updateInTransaction(
      t,
      own,
      { status: "published" },
      HOOKED
    );
    const refused = await updateInTransaction(
      t,
      others,
      { status: "published" },
      HOOKED
    );

    expect(written.result?.success).toBe(true);
    expect((await stored(t, HOOKED, own))?.title).toBe(SET_BY_A_HOOK);
    expect(statusOf(refused)).toBe(403);
    expect(await stored(t, HOOKED, others)).toEqual(before);
  });
});

describe("an update rule's filter where the read rule hides the entry", () => {
  // The read rule shows only entries titled "visible"; the author's own post
  // is titled otherwise, so the update rule's filter matches it while the
  // caller may not read it. A refusal of the write is then the missing
  // entry's 404, whatever refused it.
  const HIDDEN = "updfilter_hidden_posts";
  const HIDDEN_DRAFTED = "updfilter_hidden_drafted";

  async function bootHidden(): Promise<TestNextly> {
    const access = {
      read: () => ({ title: { equals: "visible" } }) as unknown as boolean,
      update: ownEntries,
      publish: ownEntries,
    };
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: HIDDEN,
          status: true,
          access,
          fields: [text({ name: "title" }), text({ name: "owner" })],
        }),
        defineCollection({
          slug: HIDDEN_DRAFTED,
          status: true,
          versions: { drafts: true },
          access,
          fields: [text({ name: "title" }), text({ name: "owner" })],
        }),
      ],
    });
    await userWhoMay(current, AUTHOR, "read", [HIDDEN, HIDDEN_DRAFTED]);
    await grantTo(current, AUTHOR, "update", [HIDDEN, HIDDEN_DRAFTED]);
    await grantTo(current, AUTHOR, "publish", [HIDDEN, HIDDEN_DRAFTED]);
    return current;
  }

  it("answers an update moving the entry out of the filter as missing", async () => {
    const t = await bootHidden();
    const { own } = await seed(t, HIDDEN);
    const before = await stored(t, HIDDEN, own);

    const refused = await errorOf(() =>
      update(t, HIDDEN, own, { owner: OTHER })
    );

    expect(refused.statusCode).toBe(404);
    expect(refused.code).toBe("NOT_FOUND");
    expect(await stored(t, HIDDEN, own)).toEqual(before);
  });

  it("answers a held edit to a field the filter names as missing", async () => {
    const t = await bootHidden();
    const { own } = await seed(t, HIDDEN_DRAFTED, "published");
    const before = await stored(t, HIDDEN_DRAFTED, own);

    const refused = await errorOf(() =>
      update(t, HIDDEN_DRAFTED, own, { owner: OTHER })
    );

    expect(refused.statusCode).toBe(404);
    expect(refused.code).toBe("NOT_FOUND");
    expect(await stored(t, HIDDEN_DRAFTED, own)).toEqual(before);
  });

  it("answers an update moving the entry out inside the caller's transaction as missing", async () => {
    const t = await bootHidden();
    const { own } = await seed(t, HIDDEN);
    const before = await stored(t, HIDDEN, own);

    const refused = await updateInTransaction(t, own, { owner: OTHER }, HIDDEN);

    expect(statusOf(refused)).toBe(404);
    expect(await stored(t, HIDDEN, own)).toEqual(before);
  });
});

describe("an update rule's filter on a collection with languages", () => {
  const LOCALIZED = "updfilter_localized_posts";

  it("answers an entry outside the filter that a plain read hides as missing, whatever language the update writes", async () => {
    // Whether the caller may read the entry is a plain read's question, in
    // the default language. Here the read rule matches the entry's German
    // title and not its default one, so a plain read hides the entry, and an
    // update writing German is answered as if the entry were missing.
    current = await createTestNextly({
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      collections: [
        defineCollection({
          slug: LOCALIZED,
          localized: true,
          access: {
            read: () => ({ title: { equals: "shown" } }) as unknown as boolean,
            update: ownEntries,
          },
          fields: [
            text({ name: "title" }),
            text({ name: "owner", localized: false }),
          ],
        }),
      ],
    });
    const t = current;
    await userWhoMay(t, AUTHOR, "read", [LOCALIZED]);
    await grantTo(t, AUTHOR, "update", [LOCALIZED]);
    const created = await t.nextly.create({
      collection: LOCALIZED,
      data: { title: "hidden", owner: OTHER },
    });
    const others = String(created.item.id);
    await t.nextly.update({
      collection: LOCALIZED,
      id: others,
      locale: "de",
      data: { title: "shown" },
    } as never);

    const refused = await errorOf(() =>
      t.nextly.update({
        collection: LOCALIZED,
        id: others,
        locale: "de",
        data: { title: "renamed" },
        ...asAuthor,
      } as never)
    );

    expect(refused.statusCode).toBe(404);
    expect(refused.code).toBe("NOT_FOUND");
  });
});

describe("a publish or unpublish rule that answers a filter", () => {
  it("publishes an entry the filter matches inside the caller's transaction, and refuses another's", async () => {
    // A status-only write, judged by the publish rule alone, as a plugin
    // service writes it.
    const t = await boot();
    const { own, others } = await seed(t, OPEN_POSTS);
    const othersBefore = await stored(t, OPEN_POSTS, others);

    const published = await updateInTransaction(t, own, {
      status: "published",
    });
    const refused = await updateInTransaction(t, others, {
      status: "published",
    });

    expect(published.result?.success).toBe(true);
    expect((await stored(t, OPEN_POSTS, own))?.status).toBe("published");
    expect(statusOf(refused)).toBe(403);
    expect(await stored(t, OPEN_POSTS, others)).toEqual(othersBefore);
  });

  it("publishes an edit of an entry both filters match inside the caller's transaction", async () => {
    // An edit that also publishes is judged by the update rule and by the
    // publish rule, each filter matching the author's own post.
    const t = await boot();
    const { own } = await seed(t, OPEN_POSTS);

    const written = await updateInTransaction(t, own, {
      title: "renamed",
      status: "published",
    });

    expect(written.result?.success).toBe(true);
    const row = await stored(t, OPEN_POSTS, own);
    expect(row?.title).toBe("renamed");
    expect(row?.status).toBe("published");
  });

  it("publishes an entry the filter matches, and refuses another's, leaving it", async () => {
    const t = await boot();
    const { own, others } = await seed(t, OPEN_POSTS);
    const othersBefore = await stored(t, OPEN_POSTS, others);

    await update(t, OPEN_POSTS, own, { status: "published" });
    const refused = await errorOf(() =>
      update(t, OPEN_POSTS, others, { status: "published" })
    );

    expect((await stored(t, OPEN_POSTS, own))?.status).toBe("published");
    expect(refused.statusCode).toBe(403);
    expect(await stored(t, OPEN_POSTS, others)).toEqual(othersBefore);
  });

  it("unpublishes an entry the filter matches, and answers another's it may not read as missing", async () => {
    const t = await boot();
    const { own, others } = await seed(t, POSTS, "published");
    const othersBefore = await stored(t, POSTS, others);

    await update(t, POSTS, own, { status: "draft" });
    const refused = await errorOf(() =>
      update(t, POSTS, others, { status: "draft" })
    );

    expect((await stored(t, POSTS, own))?.status).toBe("draft");
    expect(refused.statusCode).toBe(404);
    expect(await stored(t, POSTS, others)).toEqual(othersBefore);
  });

  it("shows its author an edit held on an entry the update filter matches, and not another's", async () => {
    // A held edit is shown to a caller who may edit the entry: here, one the
    // update rule's filter matches. Another's entry, whose edit a trusted
    // write held, is outside that filter, so its live row is what is read.
    const t = await boot();
    const { own, others } = await seed(t, DRAFTED, "published");
    await update(t, DRAFTED, own, { title: "edited" });
    await t.nextly.update({
      collection: DRAFTED,
      id: others,
      data: { title: "their edit" },
    } as never);
    // POPULATION CONTROL: both edits were held, not written to the live rows.
    expect((await stored(t, DRAFTED, own))?.title).toBe("mine");
    expect((await stored(t, DRAFTED, others))?.title).toBe("theirs");

    expect((await readWithDraft(t, DRAFTED, own))?.title).toBe("edited");
    expect((await readWithDraft(t, DRAFTED, others))?.title).toBe("theirs");
  });

  it("holds an edit that leaves the fields its update filter names as they are", async () => {
    const t = await boot();
    const { own } = await seed(t, DRAFTED, "published");
    const live = await stored(t, DRAFTED, own);

    await update(t, DRAFTED, own, { title: "edited" });

    expect(await stored(t, DRAFTED, own)).toEqual(live);
    expect((await readWithDraft(t, DRAFTED, own))?.title).toBe("edited");
  });

  it("refuses to hold an edit to a field its update filter names, holding nothing", async () => {
    // The update filter matches the author's own posts by `owner`. A held
    // edit changing `owner` could leave the entry outside the filter once it
    // goes live, so it is refused as a move out of the filter is, and neither
    // the live row nor a held edit carries it.
    const t = await boot();
    const { own } = await seed(t, DRAFTED, "published");
    const live = await stored(t, DRAFTED, own);

    const refused = await errorOf(() =>
      update(t, DRAFTED, own, { title: "given away", owner: OTHER })
    );

    expect(refused.statusCode).toBe(403);
    expect(await stored(t, DRAFTED, own)).toEqual(live);
    const read = await readWithDraft(t, DRAFTED, own);
    expect(read?.owner).toBe(AUTHOR);
    expect(read?.title).toBe("mine");
  });

  it("refuses to hold an edit to a field its update filter names inside the caller's transaction", async () => {
    const t = await boot();
    const { own } = await seed(t, DRAFTED, "published");
    const live = await stored(t, DRAFTED, own);

    const refused = await updateInTransaction(
      t,
      own,
      { owner: OTHER },
      DRAFTED
    );

    expect(refused.result?.success ?? false).toBe(false);
    expect(statusOf(refused)).toBe(403);
    expect(await stored(t, DRAFTED, own)).toEqual(live);
    expect((await readWithDraft(t, DRAFTED, own))?.owner).toBe(AUTHOR);
  });

  it("refuses a publish that would promote a held edit taking the entry out of the filter", async () => {
    // A published post whose edit is held as a pending change, held by a
    // trusted write: the author may not hold an edit to the field its filter
    // names. Publishing would put the edit live, and the edit hands the post
    // to someone else, outside the publish rule's filter: the publish is
    // refused, the live row keeps its owner, and the held edit is kept.
    const t = await boot();
    const { own } = await seed(t, DRAFTED, "published");

    await t.nextly.update({
      collection: DRAFTED,
      id: own,
      data: { title: "given away", owner: OTHER },
    } as never);
    const live = await stored(t, DRAFTED, own);
    // POPULATION CONTROL: the edit was held, not written to the live row, so
    // a refusal below is the publish's, not the save's.
    expect(live?.owner).toBe(AUTHOR);

    const refused = await errorOf(() =>
      update(t, DRAFTED, own, { status: "published" })
    );

    expect(refused.statusCode).toBe(403);
    expect(await stored(t, DRAFTED, own)).toEqual(live);
  });
});
