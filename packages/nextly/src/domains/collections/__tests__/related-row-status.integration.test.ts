/**
 * A related row is filtered by Draft/Published the way a direct read of it is.
 *
 * Expansion applied no lifecycle filter at all. A caller asking for an
 * unpublished row directly got a 404; populating a relationship that pointed at
 * the same row handed them the whole thing, `status: "draft"` included. So a
 * published page linking to an unpublished one disclosed that page's contents to
 * anyone permitted to read the parent.
 *
 * What propagates from the surrounding read is not a status value but whether
 * the published-only default was deliberately bypassed. The admin sends
 * `status=all` on every read for exactly that reason; a public caller never
 * does. A concrete `?status=draft` does NOT propagate: it names the lifecycle of
 * the collection being listed, not of everything that collection points at.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, relationship, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { CollectionRelationshipService } from "../services/collection-relationship-service";

const PREDICATE_RULE_PATH = new URL(
  "./_fixtures/tenant-read-rule.ts",
  import.meta.url
).pathname;

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

interface Seeded {
  handler: CollectionsHandler;
  publishedAuthorId: string;
  draftAuthorId: string;
  /** Points at the draft author. */
  draftRefId: string;
  /** Points at the published author. */
  publishedRefId: string;
}

async function boot(): Promise<Seeded> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "authors",
        status: true,
        access: {
          create: () => true,
          update: () => true,
          read: () => true,
        },
        fields: [text({ name: "name" }), text({ name: "bio" })],
      }),
      defineCollection({
        slug: "posts",
        access: {
          create: () => true,
          update: () => true,
          read: () => true,
        },
        fields: [
          text({ name: "title" }),
          relationship({ name: "author", relationTo: "authors" }),
        ],
      }),
    ],
  });

  const handler = current.getService<CollectionsHandler>("collectionsHandler");

  const published = await handler.createEntry(
    { collectionName: "authors", overrideAccess: true },
    { name: "Published Author", bio: "public bio", status: "published" }
  );
  const draft = await handler.createEntry(
    { collectionName: "authors", overrideAccess: true },
    { name: "Draft Author", bio: "unpublished bio", status: "draft" }
  );
  const publishedAuthorId = (published.data as { id: string }).id;
  const draftAuthorId = (draft.data as { id: string }).id;

  const draftRef = await handler.createEntry(
    { collectionName: "posts", overrideAccess: true },
    { title: "Points at a draft", author: draftAuthorId }
  );
  const publishedRef = await handler.createEntry(
    { collectionName: "posts", overrideAccess: true },
    { title: "Points at a published row", author: publishedAuthorId }
  );

  return {
    handler,
    publishedAuthorId,
    draftAuthorId,
    draftRefId: (draftRef.data as { id: string }).id,
    publishedRefId: (publishedRef.data as { id: string }).id,
  };
}

/** The populated author on a post, or null when the reference stayed an id. */
async function populatedAuthor(
  handler: CollectionsHandler,
  refId: string,
  extra: Record<string, unknown> = {}
): Promise<Record<string, unknown> | null> {
  const result = await handler.getEntry({
    collectionName: "posts",
    entryId: refId,
    user: { id: "reader" },
    routeAuthorized: true,
    ...extra,
  });
  expect(result.success).toBe(true);
  const author = (result.data as { author?: unknown }).author;
  return author !== null && typeof author === "object"
    ? (author as Record<string, unknown>)
    : null;
}

describe("related rows honour Draft/Published (integration)", () => {
  it("does not populate an unpublished row for an untrusted caller", async () => {
    const { handler, draftAuthorId, draftRefId } = await boot();

    // The same caller, asking the target's own endpoint, is refused.
    const direct = await handler.getEntry({
      collectionName: "authors",
      entryId: draftAuthorId,
      user: { id: "reader" },
      routeAuthorized: true,
    });
    expect(direct.success).toBe(false);
    expect(direct.statusCode).toBe(404);

    // So the relationship must not serve it either. Before this, the whole row
    // came back with `status: "draft"` and the unpublished bio on it.
    expect(await populatedAuthor(handler, draftRefId)).toBeNull();
  });

  it("still populates a published row for the same caller", async () => {
    const { handler, publishedAuthorId, publishedRefId } = await boot();

    // The mirror. A lifecycle filter that withheld everything would satisfy the
    // test above while breaking every relationship in the product.
    const author = await populatedAuthor(handler, publishedRefId);
    expect(author).not.toBeNull();
    expect(author!.id).toBe(publishedAuthorId);
    expect(author!.bio).toBe("public bio");
  });

  it("populates an unpublished row for a caller who asked to read everything", async () => {
    const { handler, draftAuthorId, draftRefId } = await boot();

    // This is what keeps the admin working: it sends `status=all` on every read
    // precisely so the published-only default does not hide drafts from it. If
    // that intent did not reach expansion, an entry form pointing at a draft
    // would render its reference unpopulated.
    const author = await populatedAuthor(handler, draftRefId, {
      status: "all",
    });
    expect(author).not.toBeNull();
    expect(author!.id).toBe(draftAuthorId);
  });

  it("populates an unpublished row for a trusted read", async () => {
    const { handler, draftAuthorId, draftRefId } = await boot();

    // A system read bypasses the lifecycle default the same way it bypasses
    // access rules.
    const result = await handler.getEntry({
      collectionName: "posts",
      entryId: draftRefId,
      overrideAccess: true,
    });
    expect(result.success).toBe(true);
    expect((result.data as { author?: { id?: string } }).author?.id).toBe(
      draftAuthorId
    );
  });

  it("does not let a draft-scoped parent read unfilter its targets", async () => {
    const { handler, draftRefId } = await boot();

    // `status=draft` names the lifecycle of the collection being read, not of
    // everything it points at — a draft post should still show only its
    // published author. Propagating a concrete status would turn a narrower
    // query into a wider disclosure.
    expect(
      await populatedAuthor(handler, draftRefId, { status: "draft" })
    ).toBeNull();
  });

  it("records a lifecycle-filtered row as withheld rather than missing", async () => {
    // A caller checking its expansion for completeness has to tell a deliberate
    // refusal from a load that failed. Filtering the row out in the query would
    // remove it before anything could record the decision, and the Single
    // authorization view would then read the unpopulated reference as evidence
    // lost and refuse the whole parent read with a 500.
    const { handler, draftAuthorId, draftRefId } = await boot();

    const withheld = new Set<string>();
    const service = current!.getService<CollectionRelationshipService>(
      "relationshipService"
    );
    const row = await service.fetchRelatedEntry("authors", draftAuthorId, {
      enforceCollectionAccess: true,
      user: { id: "reader" },
      withheldByAccess: withheld,
    });

    expect(row).toBeNull();
    // Keyed by collection AND id: an id is unique only within its collection.
    expect([...withheld].some(key => key.includes(draftAuthorId))).toBe(true);
    // And the parent read still succeeds rather than erroring.
    expect(await populatedAuthor(handler, draftRefId)).toBeNull();
  });

  it("does not record a reference that points at nothing as withheld", async () => {
    // The mirror, and the reason the recording is not simply "every id that did
    // not come back": a dangling reference is a data problem, and dressing it up
    // as a refusal would let a completeness check accept a genuine absence.
    await boot();

    const withheld = new Set<string>();
    const service = current!.getService<CollectionRelationshipService>(
      "relationshipService"
    );
    const row = await service.fetchRelatedEntry(
      "authors",
      "00000000-0000-4000-8000-000000000000",
      {
        enforceCollectionAccess: true,
        user: { id: "reader" },
        withheldByAccess: withheld,
      }
    );

    expect(row).toBeNull();
    expect([...withheld]).toEqual([]);
  });

  it("keeps a draft target through predicate confirmation for status=all", async () => {
    // A rule answering with a predicate confirms its rows in a second query.
    // Re-resolving the lifecycle there without the caller's intent re-applies
    // the published-only default, so an editor reading everything loses the
    // draft row the first fetch admitted.
    const { handler, draftAuthorId, draftRefId } = await boot();
    await current!.adapter.update(
      "dynamic_collections",
      {
        access_rules: {
          read: { type: "custom", functionPath: PREDICATE_RULE_PATH },
        },
      },
      { and: [{ column: "slug", op: "=", value: "authors" }] }
    );

    // `name-scoped` answers with a predicate over a column `authors` has, so
    // the confirming query really runs. A caller whose rule answers `true`
    // never reaches it and would pass this test either way.
    const author = await populatedAuthor(handler, draftRefId, {
      status: "all",
      user: { id: "name-scoped" },
    });
    expect(author?.id).toBe(draftAuthorId);
  });

  it("leaves a target with no lifecycle alone", async () => {
    // A status-less target has nothing to filter on, and a predicate naming a
    // column its table lacks would fail the whole read and withhold every row.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "tags",
          access: { create: () => true, read: () => true },
          fields: [text({ name: "label" })],
        }),
        defineCollection({
          slug: "posts",
          access: { create: () => true, read: () => true },
          fields: [
            text({ name: "title" }),
            relationship({ name: "tag", relationTo: "tags" }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const tag = await handler.createEntry(
      { collectionName: "tags", overrideAccess: true },
      { label: "news" }
    );
    const tagId = (tag.data as { id: string }).id;
    const post = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "P", tag: tagId }
    );

    const result = await handler.getEntry({
      collectionName: "posts",
      entryId: (post.data as { id: string }).id,
      user: { id: "reader" },
      routeAuthorized: true,
    });
    expect(result.success).toBe(true);
    expect((result.data as { tag?: { id?: string } }).tag?.id).toBe(tagId);
  });
});
