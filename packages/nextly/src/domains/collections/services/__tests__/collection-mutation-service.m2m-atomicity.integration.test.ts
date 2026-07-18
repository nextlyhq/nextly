/**
 * Proof that a many-to-many junction write failure rolls back the entry.
 *
 * `CollectionMutationService.createEntry`/`updateEntry` used to write the
 * junction rows AFTER `adapter.transaction(...)` committed the entry (on the
 * pool, not the transaction's connection) — a junction failure left an
 * orphaned entry (create) or a committed scalar change with no way to undo it
 * (update). The fix moves the junction write inside the same transaction,
 * passing `tx.getDrizzle?.<RelationshipDbExecutor>()` down to
 * `insertManyToManyRelations`/`deleteManyToManyRelations` so a junction
 * failure aborts the whole transaction.
 *
 * Code-first collections cannot express many-to-many (the typed
 * `relationship()` helper only supports `hasMany`), so this suite builds a
 * REAL junction table via `seedBuilderCollection` (the Schema-Builder path),
 * mirroring the setup in collection-relationship-service.m2m.integration.test.ts:
 * seed `tags` then `posts` (with a raw m2m FieldDefinition) on a first boot,
 * reset DI without disconnecting the adapter, then reboot on the SAME adapter
 * so `collectionService` resolves against the seeded collections.
 *
 * Failure injection: after seeding, `DROP TABLE dc_posts_dc_tags_tags` so any
 * subsequent `insertManyToManyRelations`/`deleteManyToManyRelations` call
 * throws "junction does not exist" from inside the widened transaction.
 *
 * This drives the mutation path through `getService("collectionService")`
 * (not `relationshipService` directly) because `CollectionService.createEntry`/
 * `updateEntry` throw a `NextlyError` on failure (unlike the lower-level
 * `CollectionMutationService`, which returns `{ success: false }`), giving a
 * clean `rejects.toThrow()` assertion while still exercising the exact
 * product code under test (`CollectionService` → `CollectionEntryService` →
 * `CollectionMutationService`).
 */
import { afterEach, describe, expect, it } from "vitest";

import { clearServices } from "../../../../di/register";
import { seedBuilderCollection } from "../../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionService } from "../collection-service";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

/**
 * Recipe: seed the target collection (`tags`) then the source collection
 * (`posts`, carrying the m2m field) on a first boot — seeding emits the real
 * junction table DDL (`dc_posts_dc_tags_tags`). Reset DI without disconnecting
 * the in-memory adapter, then reboot on the SAME adapter so `collectionService`
 * resolves against the seeded collections (mirrors the relationship-service
 * m2m suite's setup).
 */
async function seedTagsAndPosts(): Promise<{
  collections: CollectionService;
  tagId: string;
}> {
  handle = await createTestNextly({});
  const adapter = handle.adapter;

  await seedBuilderCollection(adapter, {
    slug: "tags",
    fields: [{ name: "name", type: "text" }],
  });
  await seedBuilderCollection(adapter, {
    slug: "posts",
    fields: [
      { name: "title", type: "text" },
      {
        name: "tags",
        type: "relationship",
        options: { relationType: "manyToMany", target: "tags" },
      },
    ],
  });

  clearServices();
  handle = await createTestNextly({ adapter });

  const collections = handle.getService(
    "collectionService"
  ) as CollectionService;

  const tagId = "tag-1";
  // Raw SQL, not adapter.insert(): matches the seeding convention in the
  // sibling relationship-service m2m suite (no typed column path exists for
  // a manyToMany field's junction target row).
  const nowEpoch = Math.floor(Date.now() / 1000);
  await adapter.executeQuery(
    `INSERT INTO dc_tags (id, title, slug, name, created_at, updated_at) VALUES ('${tagId}', 'JavaScript', 'javascript', 'javascript', ${nowEpoch}, ${nowEpoch})`
  );

  return { collections, tagId };
}

describe("CollectionMutationService m2m write atomicity (integration)", () => {
  it("createEntry rolls back the entry when the junction insert fails", async () => {
    const { collections, tagId } = await seedTagsAndPosts();
    const adapter = handle!.adapter;

    // Drop the junction table so insertManyToManyRelations throws from
    // inside the entry's transaction.
    await adapter.executeQuery(`DROP TABLE "dc_posts_dc_tags_tags"`);

    await expect(
      collections.createEntry(
        "posts",
        { title: "Hello", tags: [tagId] },
        { overrideAccess: true }
      )
    ).rejects.toThrow();

    // Pre-fix, the junction write ran AFTER the entry's transaction
    // committed, so the entry would survive here. Post-fix, the junction
    // write is inside the transaction, so the entry never lands.
    const rows = await adapter.executeQuery<{ id: string }>(
      `SELECT id FROM dc_posts`
    );
    expect(rows).toHaveLength(0);
  });

  it("updateEntry rolls back the scalar change when the junction write fails", async () => {
    const { collections, tagId } = await seedTagsAndPosts();
    const adapter = handle!.adapter;

    // Create successfully first (junction intact) so there is a real,
    // persisted entry to attempt the update against.
    const created = (await collections.createEntry(
      "posts",
      { title: "Original", tags: [tagId] },
      { overrideAccess: true }
    )) as { id: string };
    const postId = created.id;

    // Now break the junction for the update attempt.
    await adapter.executeQuery(`DROP TABLE "dc_posts_dc_tags_tags"`);

    await expect(
      collections.updateEntry(
        "posts",
        postId,
        { title: "Changed", tags: [] },
        { overrideAccess: true }
      )
    ).rejects.toThrow();

    // Pre-fix, the scalar UPDATE committed on its own transaction before the
    // (pool-level) junction delete ran, so the title would have changed here.
    // Post-fix, the scalar UPDATE and the junction delete share one
    // transaction, so a junction failure rolls the title back too.
    const rows = await adapter.executeQuery<{ title: string }>(
      `SELECT title FROM dc_posts WHERE id = '${postId}'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Original");
  });
});
