/**
 * A document-dependent (owner-only) publish/unpublish rule must be enforced
 * against the SPECIFIC row on the transaction and batch write paths, not only on
 * the single-write path.
 *
 * The transaction/batch paths pre-resolve the caller's publish PERMISSION once on
 * the pooled connection before the transaction. That pre-resolve has no document,
 * so an owner-only rule (which allows until the row is known) passes there. If the
 * gate stopped at the pre-resolved permission, a caller who may update another
 * user's row could batch-publish it. This pins that the owner-only rule is
 * re-evaluated against the row-locked document inside the transaction: the owner
 * may publish their own row; a non-owner who can update it still cannot publish
 * it. The permission level allows (code `access.publish` returns true), so the
 * owner-only DOCUMENT rule is the only thing under test.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function bootOwnerOnlyPosts(): Promise<TestNextly> {
  return createTestNextly({
    collections: [
      defineCollection({
        slug: "posts",
        status: true,
        // Permission level allows every op, so only the stored owner-only
        // document rule below decides whether a publish transition is allowed.
        access: {
          create: () => true,
          update: () => true,
          read: () => true,
          publish: () => true,
          unpublish: () => true,
        },
        fields: [text({ name: "title" })],
      }),
    ],
    // Stored rule the Schema Builder would persist: only the row's owner may
    // move it into or out of published.
    collectionAccessRules: {
      posts: {
        publish: { type: "owner-only" },
        unpublish: { type: "owner-only" },
      },
    },
  });
}

describe("owner-only publish enforcement on batch paths (integration)", () => {
  it("refuses a batch UPDATE that publishes another user's rows", async () => {
    current = await bootOwnerOnlyPosts();
    const entryService = current
      .getService<CollectionsHandler>("collectionsHandler")
      .getEntryService();

    // Seed two drafts OWNED by "author" (created_by = author). Draft creates do
    // not trip the publish gate, so this is plain setup.
    const seeded = await entryService.createEntries(
      { collectionName: "posts", user: { id: "author" } },
      [
        { title: "a", status: "draft" },
        { title: "b", status: "draft" },
      ]
    );
    const ids = seeded.ids;
    expect(ids).toHaveLength(2);

    // A different user who may update the rows tries to publish them. The
    // permission pre-resolve allows publish (access.publish → true), but the
    // owner-only rule, judged against each row-locked document, denies a
    // non-owner: every row fails.
    const foreignPublish = await entryService.updateEntries(
      { collectionName: "posts", user: { id: "intruder" } },
      ids.map(id => ({ id, data: { status: "published" } }))
    );
    expect(foreignPublish.successful).toBe(0);
    expect(foreignPublish.failed).toBe(2);

    // The owner publishing their own rows is allowed.
    const ownerPublish = await entryService.updateEntries(
      { collectionName: "posts", user: { id: "author" } },
      ids.map(id => ({ id, data: { status: "published" } }))
    );
    expect(ownerPublish.successful).toBe(2);
    expect(ownerPublish.failed).toBe(0);
  });

  it("refuses a batch UPDATE that unpublishes another user's rows", async () => {
    current = await bootOwnerOnlyPosts();
    const entryService = current
      .getService<CollectionsHandler>("collectionsHandler")
      .getEntryService();

    // Seed a published row owned by "author" (setup): a create has no prior row,
    // so the owner-only rule allows the creator to land it published.
    const seeded = await entryService.createEntries(
      { collectionName: "posts", user: { id: "author" } },
      [{ title: "a", status: "published" }]
    );
    const [id] = seeded.ids;
    expect(id).toBeDefined();

    // A non-owner who may update the row tries to unpublish it → denied.
    const foreignUnpublish = await entryService.updateEntries(
      { collectionName: "posts", user: { id: "intruder" } },
      [{ id, data: { status: "draft" } }]
    );
    expect(foreignUnpublish.successful).toBe(0);
    expect(foreignUnpublish.failed).toBe(1);

    // The owner may unpublish their own row.
    const ownerUnpublish = await entryService.updateEntries(
      { collectionName: "posts", user: { id: "author" } },
      [{ id, data: { status: "draft" } }]
    );
    expect(ownerUnpublish.successful).toBe(1);
    expect(ownerUnpublish.failed).toBe(0);
  });
});
