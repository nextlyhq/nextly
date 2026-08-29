/**
 * A due release must mean the same thing wherever a document is read from.
 *
 * A post points at an author. Reading the author DIRECTLY already honours a due
 * release — that is what the collection read path now does. Reading the same
 * author THROUGH the post is a different code path, against a different
 * collection than the caller named, and it applies the lifecycle in two more
 * places: an in-memory filter over rows it deliberately fetched unfiltered, and
 * a SQL condition on the authorized re-read.
 *
 * If those disagree with the direct read, the same document is published when
 * asked for by name and missing when arrived at by reference — and the caller
 * sees a post whose author has vanished.
 *
 * ## This is not a trust widening
 *
 * Expansion has careful rules about which callers may inherit a widened
 * lifecycle (`expansionStatusScope`, `widensLifecycle`), and they are about
 * TRUST — whether this caller may see unpublished content. A due release is not
 * that. It says the document IS published, for everyone, including an anonymous
 * visitor. So it applies regardless of how the caller bounded itself, and a
 * bounded caller seeing it is correct rather than a leak.
 *
 * @module domains/releases/__tests__/release-reveals-in-expansion.integration.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, relationship, text } from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { ReleasesRepository } from "../releases-repository";
import { seedLiveAuthor } from "./helpers/live-author";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const POSTS = "posts";
const AUTHORS = "authors";
const PAST = new Date("2020-01-01T00:00:00Z");
const FUTURE = new Date("2099-01-01T00:00:00Z");

async function boot(dialect: TestDialect): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: AUTHORS,
        status: true,
        access: { read: () => true, update: () => true },
        fields: [text({ name: "name" })],
      }),
      defineCollection({
        slug: POSTS,
        status: true,
        access: { read: () => true, update: () => true },
        fields: [
          text({ name: "title" }),
          relationship({ name: "author", relationTo: AUTHORS }),
        ],
      }),
    ],
  });
  return current;
}

const handlerOf = (t: TestNextly): CollectionsHandler =>
  t.getService("collectionsHandler") as CollectionsHandler;

/** A published post whose author is a draft in a release. */
async function postWithDraftAuthor(
  t: TestNextly,
  scheduledAt: Date | null
): Promise<string> {
  const handler = handlerOf(t);
  const author = await handler.createEntry(
    { collectionName: AUTHORS, overrideAccess: true },
    { name: "Ada", status: "draft" }
  );
  const authorId = (author.data as { id?: string } | undefined)?.id;
  if (typeof authorId !== "string") throw new Error("no author id");

  const post = await handler.createEntry(
    { collectionName: POSTS, overrideAccess: true },
    { title: "live", status: "published", author: authorId }
  );
  const postId = (post.data as { id?: string } | undefined)?.id;
  if (typeof postId !== "string") throw new Error("no post id");

  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({ title: "Go live" });
  await repo.addMember({
    releaseId: release.id,
    scopeKind: "collection",
    scopeSlug: AUTHORS,
    entryId: authorId,
    locale: null,
    action: "publish",
    // A live author: the read path projects a due member only when its author
    // still exists and is active, matching the write path that runs AS them.
    createdBy: await seedLiveAuthor(t),
  });
  if (scheduledAt !== null) {
    await repo.scheduleRelease(release.id, scheduledAt, "UTC");
  }
  return postId;
}

/** A published post whose PUBLISHED author is being withdrawn by a release. */
async function postWithWithdrawnAuthor(
  t: TestNextly,
  scheduledAt: Date | null
): Promise<string> {
  const handler = handlerOf(t);
  const author = await handler.createEntry(
    { collectionName: AUTHORS, overrideAccess: true },
    { name: "Ada", status: "published" }
  );
  const authorId = (author.data as { id?: string } | undefined)?.id;
  if (typeof authorId !== "string") throw new Error("no author id");

  const post = await handler.createEntry(
    { collectionName: POSTS, overrideAccess: true },
    { title: "live", status: "published", author: authorId }
  );
  const postId = (post.data as { id?: string } | undefined)?.id;
  if (typeof postId !== "string") throw new Error("no post id");

  const repo = new ReleasesRepository(t.adapter);
  const release = await repo.createRelease({ title: "Take the author down" });
  await repo.addMember({
    releaseId: release.id,
    scopeKind: "collection",
    scopeSlug: AUTHORS,
    entryId: authorId,
    locale: null,
    action: "unpublish",
    createdBy: await seedLiveAuthor(t),
  });
  if (scheduledAt !== null) {
    await repo.scheduleRelease(release.id, scheduledAt, "UTC");
  }
  return postId;
}

/** Whether an ordinary untrusted read of the post carries its author. */
async function authorExpanded(t: TestNextly, postId: string): Promise<boolean> {
  const result = await handlerOf(t).getEntry({
    collectionName: POSTS,
    entryId: postId,
    depth: 1,
  });
  const author = (result.data as { author?: unknown } | undefined)?.author;
  return author !== null && author !== undefined && typeof author === "object";
}

describe.each(getConfiguredTestDialects())(
  "a due release reaches an expansion too (%s)",
  dialect => {
    it("expands an author whose release has come due", async () => {
      const t = await boot(dialect);
      const postId = await postWithDraftAuthor(t, PAST);
      expect(await authorExpanded(t, postId)).toBe(true);
    });

    it("does not expand it before the release is due", async () => {
      // The control. Without it, an expansion that simply ignored the target's
      // lifecycle would satisfy the case above while handing every draft author
      // to an anonymous reader through any post that points at one.
      const t = await boot(dialect);
      const postId = await postWithDraftAuthor(t, FUTURE);
      expect(await authorExpanded(t, postId)).toBe(false);
    });

    it("stops expanding an author whose takedown has come due", async () => {
      // The withdrawal direction through the expansion, which had no test.
      // Deleting `hidden.has(id)` from the in-memory filter failed nothing:
      // the row's stored status still says `published`, which is precisely
      // what the release is undoing, so the filter admitted it and an
      // anonymous reader kept seeing a withdrawn author through any post
      // pointing at one.
      const t = await boot(dialect);
      const postId = await postWithWithdrawnAuthor(t, PAST);
      expect(await authorExpanded(t, postId)).toBe(false);
    });

    it("still expands it before the takedown is due", async () => {
      // The control. An expansion that dropped every target named by any
      // release member would satisfy the case above while hiding authors whose
      // takedown has not arrived.
      const t = await boot(dialect);
      const postId = await postWithWithdrawnAuthor(t, FUTURE);
      expect(await authorExpanded(t, postId)).toBe(true);
    });
  }
);
