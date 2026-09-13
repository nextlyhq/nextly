/**
 * `content:empty` against a real instance.
 *
 * The filter's rules are asked directly in `conditions.test.ts`; what cannot be
 * asked there is whether the EVALUATOR reaches a real collection, resolves its
 * slug, and counts through the guarded path. Each of those can be wrong in a
 * way that returns a plausible boolean — a mis-sliced source id counts nothing
 * and reports the install empty, which on a fresh install is also the right
 * answer.
 *
 * So the assertions move the answer: the same instance, before and after a row
 * exists. A condition that always said `true` would satisfy the empty case and
 * fail the second.
 *
 * The layout read asks the same condition for the dashboard itself, whether or
 * not a widget names it, so `layoutConditions` is asked here with no widgets.
 *
 * A single is asked the same way, with one difference that shapes every case:
 * its row is created by the first read, so the answer has to move with a SAVE
 * rather than with the row existing.
 *
 * @module domains/widgets/__tests__/conditions-content.integration.test
 */

import assert from "node:assert/strict";

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, defineSingle, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { refreshCollectionSources } from "../collection-sources";
import { refreshCollectionWidgets } from "../collection-widgets";
import { evaluateConditions, layoutConditions } from "../conditions";
import { listSources } from "../sources";

const NOTES = "notes";
/** A collection whose rows the reader under test may NOT read. */
const SECRETS = "secrets";

/** An admin: the reader onboarding actually meets, and one who may read all. */
const admin: ReadCaller = {
  user: { id: "admin-1", roles: ["admin"] },
};

type WriteHandler = {
  createEntry: (
    p: Record<string, unknown>,
    data: Record<string, unknown>
  ) => Promise<{ success: boolean }>;
};

/**
 * Writes a row and REFUSES to continue if the write did not land.
 *
 * Without this a failed insert leaves the install empty, and "empty" is the
 * answer both remaining assertions are trying to move away from -- so a broken
 * fixture would report the condition working perfectly.
 */
async function write(
  t: TestNextly,
  data: Record<string, unknown>,
  collection: string = NOTES
): Promise<void> {
  const handler = t.getService("collectionsHandler") as unknown as WriteHandler;
  const result = await handler.createEntry(
    { collectionName: collection, overrideAccess: true },
    data
  );
  expect(result.success).toBe(true);
}

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(): Promise<TestNextly> {
  const t = await createTestNextly({
    collections: [
      defineCollection({
        slug: SECRETS,
        // Readable by nobody. The condition must not see these rows, and the
        // only way to know it does not is to have some.
        access: { read: () => false, create: () => true, update: () => true },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: NOTES,
        // The publishing lifecycle is ON, so a draft is a thing this collection
        // can hold. Without it `status: "draft"` names nothing and the write
        // below would not land -- leaving the install genuinely empty and the
        // draft assertion passing for the wrong reason.
        status: true,
        access: { read: () => true, create: () => true, update: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  current = t;
  // The same call `POST /api/dashboard/query` makes before resolving anything:
  // publish the collection sources from the LIVE registry. Boot does not, and
  // the evaluator reads that registry to know which collections exist -- so
  // without this it would ask about nothing and report every install empty.
  await refreshCollectionSources();
  return t;
}

async function contentEmpty(): Promise<boolean> {
  const verdicts = await evaluateConditions(new Set(["content:empty"]), admin);
  return verdicts.get("content:empty") === true;
}

describe("content:empty against a real instance", () => {
  it("holds while the collection has no rows", async () => {
    await boot();
    expect(await contentEmpty()).toBe(true);
  });

  it("stops holding once a row exists", async () => {
    // The must-differ half. Without it, an evaluator that never reached the
    // collection -- a mis-sliced source id, an unrefreshed registry -- would
    // report the install empty forever and pass the case above.
    const t = await boot();
    await write(t, { title: "the first note" });

    expect(await contentEmpty()).toBe(false);
  });

  it("does NOT count content this reader may not read", async () => {
    // 🔴 The claim `content:empty` makes is that it is READER-SCOPED, and every
    // other case here grants the reader everything -- so none of them could
    // tell a reader-scoped count from an unscoped one.
    //
    // The guard this actually exercises is the ENTITY filter: a collection the
    // reader may not read is dropped before any count is issued. Verified by
    // removing that filter, which fails this case by name.
    //
    // What it does NOT reach is the row-level guard. `overrideAccess: false` on
    // the count protects rows inside a collection the reader MAY read, and this
    // fixture denies the whole collection, so the rows never get that far --
    // flipping `overrideAccess` here changes nothing, which was measured rather
    // than assumed. Covering that needs a readable collection with a row rule,
    // and it is stated here rather than left to look covered.
    const t = await boot();
    await write(t, { title: "not for you" }, SECRETS);

    expect(await contentEmpty()).toBe(true);
  });

  it("counts a DRAFT as content", async () => {
    // A reader who has written one post and not published it is not looking at
    // an empty install, and telling them they are is the onboarding equivalent
    // of losing their work. `status: "all"` is what makes this true, and a
    // published-only count would report empty here.
    const t = await boot();
    await write(t, { title: "unpublished", status: "draft" });

    expect(await contentEmpty()).toBe(false);
  });
});

describe("the layout read's own content answer", () => {
  it("is asked with no widget naming it, and counts only what the reader may read", async () => {
    // A row the reader may not read leaves the install empty for them; a row
    // they may read is what moves it. Both against one instance, so an answer
    // that never reached the collections cannot satisfy the pair.
    const t = await boot();
    await write(t, { title: "not for you" }, SECRETS);
    expect((await layoutConditions([], admin)).contentEmpty).toBe(true);

    await write(t, { title: "the first note" });
    expect((await layoutConditions([], admin)).contentEmpty).toBe(false);
  });
});

/** A single the reader under test may read. */
const HOMEPAGE = "homepage";
/** A single whose code rule refuses everyone: the reader-scoping control. */
const PRIVATE_NOTE = "private-note";

async function bootSingles(): Promise<TestNextly> {
  const t = await createTestNextly({
    singles: [
      defineSingle({
        slug: HOMEPAGE,
        access: { read: () => true, update: () => true },
        fields: [text({ name: "headline" })],
      }),
      defineSingle({
        slug: PRIVATE_NOTE,
        access: { read: () => false, update: () => true },
        fields: [text({ name: "note" })],
      }),
    ],
  });
  current = t;
  // Both kinds of source, as the layout read publishes them before it asks:
  // the singles walk stays inside the `single:` sources, and boot publishes
  // none.
  await refreshCollectionWidgets();
  return t;
}

/** A single's table, from the registry rather than from a guess at its name. */
async function tableOf(t: TestNextly, slug: string): Promise<string> {
  const single = await t
    .getService("singleRegistryService")
    .getSingleBySlug(slug);
  assert(single, `no single registered as ${slug}`);
  return single.tableName;
}

/** A single's stored rows, read from its table rather than through the read path. */
async function storedRows(
  t: TestNextly,
  slug: string
): Promise<Record<string, unknown>[]> {
  return t.adapter.select<Record<string, unknown>>(await tableOf(t, slug));
}

/**
 * What opening a single in the admin does first -- the read creates its row
 * with the defaults -- and then both stored instants moved a minute back, as
 * though that read happened a minute before whatever the case does next.
 *
 * The move is what keeps a saved single apart from an unsaved one on every
 * dialect. SQLite keeps whole seconds, so a save landing in the same second as
 * the read that created the row cannot be told from no save at all: a gap no
 * editor leaves, and every test does.
 */
async function openedAMinuteAgo(t: TestNextly, slug: string): Promise<void> {
  await t.nextly.findSingle({ slug, overrideAccess: true });
  const rows = await storedRows(t, slug);
  assert(rows.length === 1, `${slug} should hold exactly one row`);
  const id = rows[0]?.id;
  assert(typeof id === "string", `${slug}'s row has no id`);
  const aMinuteAgo = new Date(Date.now() - 60_000);
  await t.adapter.update(
    await tableOf(t, slug),
    { created_at: aMinuteAgo, updated_at: aMinuteAgo },
    { and: [{ column: "id", op: "=", value: id }] }
  );
}

/** A save through the ordinary write path, which throws when it does not land. */
async function save(
  t: TestNextly,
  slug: string,
  data: Record<string, unknown>
): Promise<void> {
  await t.nextly.updateSingle({ slug, data, overrideAccess: true });
}

describe("a single as content", () => {
  it("is not content while nobody has saved it, though a read created its row", async () => {
    // The row exists -- `openedAMinuteAgo` refuses to continue without it --
    // and holds only the defaults the read wrote. Counted on existence, every
    // install whose template defines a single would stop being empty the
    // moment its dashboard was opened.
    const t = await bootSingles();
    await openedAMinuteAgo(t, HOMEPAGE);

    expect((await layoutConditions([], admin)).contentEmpty).toBe(true);
  });

  it("is content once saved", async () => {
    // The must-differ half: the same steps and one save. A condition that
    // never read a single would report the install empty and pass the case
    // above.
    const t = await bootSingles();
    await openedAMinuteAgo(t, HOMEPAGE);
    await save(t, HOMEPAGE, { headline: "Welcome" });

    expect((await layoutConditions([], admin)).contentEmpty).toBe(false);
  });

  it("does NOT count a saved single this reader may not read", async () => {
    // Reader-scoped like the entries. The save landed -- its value is read back
    // from the table -- and this reader's answer still does not move.
    const t = await bootSingles();
    await openedAMinuteAgo(t, PRIVATE_NOTE);
    await save(t, PRIVATE_NOTE, { note: "not for you" });
    expect((await storedRows(t, PRIVATE_NOTE))[0]?.note).toBe("not for you");

    expect((await layoutConditions([], admin)).contentEmpty).toBe(true);
  });

  it("does not read a single whose source is withheld, saved or not", async () => {
    // A single whose migration is pending has no source, and its table may not
    // exist: reading it would throw and leave the condition unanswered for the
    // whole dashboard. So it is not read -- the rule the entry walk keeps for a
    // collection mid-migration. The withheld source is the control.
    const t = await bootSingles();
    await openedAMinuteAgo(t, HOMEPAGE);
    await save(t, HOMEPAGE, { headline: "Welcome" });
    await t
      .getService("singleRegistryService")
      .updateMigrationStatus(HOMEPAGE, "pending");
    await refreshCollectionWidgets();
    expect(
      listSources().some(source => source.id === `single:${HOMEPAGE}`)
    ).toBe(false);

    expect((await layoutConditions([], admin)).contentEmpty).toBe(true);
  });

  it("does not create a single's row by asking", async () => {
    // The read path creates a missing row. This question must not, or every
    // dashboard load would write a default row for every single.
    const t = await bootSingles();

    expect((await layoutConditions([], admin)).contentEmpty).toBe(true);
    expect(await storedRows(t, HOMEPAGE)).toEqual([]);
  });
});
