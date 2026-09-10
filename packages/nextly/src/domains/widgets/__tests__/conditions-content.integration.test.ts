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
 * @module domains/widgets/__tests__/conditions-content.integration.test
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { refreshCollectionSources } from "../collection-sources";
import { evaluateConditions } from "../conditions";

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
