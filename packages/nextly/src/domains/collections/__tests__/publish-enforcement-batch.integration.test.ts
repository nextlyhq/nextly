/**
 * The publish gate must hold on the Direct-API BATCH worker paths, not only the
 * single-write path.
 *
 * `createMany` / `updateMany` funnel every row through
 * `create/updateSingleEntryInTransaction` inside one shared transaction. Those
 * workers resolve the caller's publish/unpublish authorization ONCE on the pooled
 * connection before the transaction, then enforce each row's transition against
 * the status read under the row lock — so a batch cannot become a way around the
 * gate, and no permission read runs inside the shared transaction. This pins that
 * behaviour with a collection whose code-defined `access.publish` refuses: a batch
 * that lands rows on `published` fails every row; a batch that keeps them draft
 * succeeds.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { CollectionService } from "../services/collection-service";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describe("publish enforcement on the batch worker paths (integration)", () => {
  it("refuses a batch CREATE that lands rows on published without publish", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          // Allow create/update/read but refuse publish, so the batch reaches the
          // worker (create/update pass) and only the publish transition is gated.
          access: {
            create: () => true,
            update: () => true,
            read: () => true,
            publish: () => false,
          },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const collectionService =
      current.getService<CollectionService>("collectionService");

    // Non-trusted caller (no overrideAccess) → the create worker enforces the
    // create-as-published against access.publish and refuses every row.
    const publishAttempt = await collectionService.createMany(
      "posts",
      [
        { title: "a", status: "published" },
        { title: "b", status: "published" },
      ],
      { user: { id: "author" } }
    );
    expect(publishAttempt.successful).toBe(0);
    expect(publishAttempt.failed).toBe(2);

    // The same batch kept as draft is allowed — only the publish transition is
    // gated, not the create itself.
    const draftBatch = await collectionService.createMany(
      "posts",
      [
        { title: "c", status: "draft" },
        { title: "d", status: "draft" },
      ],
      { user: { id: "author" } }
    );
    expect(draftBatch.successful).toBe(2);
    expect(draftBatch.failed).toBe(0);
  });

  it("refuses a batch UPDATE that publishes drafts without publish", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          access: {
            create: () => true,
            update: () => true,
            read: () => true,
            publish: () => false,
          },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const entryService = handler.getEntryService();

    // Seed two drafts with a trusted write (setup, not under test).
    const seeded = await handler
      .getEntryService()
      .createEntries({ collectionName: "posts", overrideAccess: true }, [
        { title: "a", status: "draft" },
        { title: "b", status: "draft" },
      ]);
    const ids = seeded.ids;
    expect(ids).toHaveLength(2);

    // A non-trusted batch update that moves the drafts to published must fail
    // every row: the update worker classifies the transition under the row lock
    // and consults the pre-resolved publish denial.
    const publishAttempt = await entryService.updateEntries(
      { collectionName: "posts", user: { id: "author" } },
      ids.map(id => ({ id, data: { status: "published" } }))
    );
    expect(publishAttempt.successful).toBe(0);
    expect(publishAttempt.failed).toBe(2);

    // A content-only batch update (no status change) is untouched by the gate.
    const contentEdit = await entryService.updateEntries(
      { collectionName: "posts", user: { id: "author" } },
      ids.map(id => ({ id, data: { title: "edited" } }))
    );
    expect(contentEdit.successful).toBe(2);
    expect(contentEdit.failed).toBe(0);
  });
});
