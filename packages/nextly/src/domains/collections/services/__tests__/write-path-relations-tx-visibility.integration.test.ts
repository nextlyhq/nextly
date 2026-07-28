/**
 * Proof that a tx-API write assembles its many-to-many relations from the
 * junction on the CALLER'S transaction, so a target created earlier in the same
 * uncommitted transaction is still listed.
 *
 * `buildFullSnapshotRelations` used to map over rows returned by
 * `fetchManyToManyRelations`, which reads the junction on the transaction but
 * materializes the TARGET rows through the pool. A target created earlier in the
 * same transaction is invisible on that second connection, so the id array came
 * back empty and both the version snapshot and the webhook event silently
 * dropped a relationship that committed successfully. Reading the ids straight
 * from the junction on the transaction fixes it.
 *
 * Code-first collections cannot express many-to-many, so this builds a real
 * junction via `seedBuilderCollection` (the Schema-Builder path), mirroring the
 * m2m-atomicity suite: seed `tags` then `posts` (with a raw m2m FieldDefinition)
 * on a first boot, reset DI without disconnecting the adapter, then reboot on
 * the SAME adapter.
 */
import { afterEach, describe, expect, it } from "vitest";

import { clearServices } from "../../../../di/register";
import { seedBuilderCollection } from "../../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../../services/collections-handler";
import type { CollectionEntryService } from "../../../../services/collections/collection-entry-service";

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

interface EventRow {
  type: string;
  payload: unknown;
}

async function seedTagsAndPosts(): Promise<CollectionEntryService> {
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

  return handle
    .getService<CollectionsHandler>("collectionsHandler")
    .getEntryService() as CollectionEntryService;
}

/** Parse the stored envelope (JSON string on some dialects, object on others). */
function envelopeOf(row: EventRow): Record<string, unknown> {
  return typeof row.payload === "string"
    ? (JSON.parse(row.payload) as Record<string, unknown>)
    : row.payload;
}

describe("tx-API m2m relations read from the caller's transaction (integration)", () => {
  it("lists a target created earlier in the same transaction", async () => {
    const entries = await seedTagsAndPosts();
    const adapter = handle!.adapter;

    // Create the target AND the referencing source in ONE transaction, so the
    // tag row is uncommitted when the post's relations are assembled. A pooled
    // target-row fetch would not see it; the junction read on `tx` must.
    let postId = "";
    let tagId = "";
    await adapter.transaction(async tx => {
      const tag = await entries.createEntryInTransaction(
        tx as never,
        { collectionName: "tags", overrideAccess: true },
        { title: "JavaScript", name: "javascript" }
      );
      tagId = (tag.data as { id: string }).id;
      const post = await entries.createEntryInTransaction(
        tx as never,
        { collectionName: "posts", overrideAccess: true },
        { title: "Hello", tags: [tagId] }
      );
      postId = (post.data as { id: string }).id;
    });

    // `nextly_events` is a shared fixed-name table; scope to THIS post's own
    // create event (top-level `type` column, envelope `resource.id`).
    const rows = await adapter.select<EventRow>("nextly_events");
    const postCreated = rows.filter(r => {
      if (r.type !== "entry.created") return false;
      const resource = envelopeOf(r).resource as { id?: string } | undefined;
      return resource?.id === postId;
    });
    expect(postCreated).toHaveLength(1);
    const data = envelopeOf(postCreated[0]).data as { tags?: unknown };
    expect(
      data.tags,
      "the post's entry.created event must list the tag created in the same transaction"
    ).toEqual([tagId]);
  });

  it("aborts the whole batch when the post-write relation read fails", async () => {
    const entries = await seedTagsAndPosts();
    const adapter = handle!.adapter;

    // Drop the junction so every item's post-write relational assembly throws
    // from inside the shared batch transaction. That failure is raised AFTER the
    // row is inserted, so it must abort the transaction rather than be swallowed
    // into a soft per-item failure that commits an unversioned row.
    await adapter.executeQuery(`DROP TABLE "dc_posts_dc_tags_tags"`);

    const result = await entries.createEntries(
      { collectionName: "posts", overrideAccess: true },
      [{ title: "A" }, { title: "B" }]
    );

    expect(result.successful).toBe(0);
    // Post-fix: the marked failure aborts the batch, so NEITHER row commits.
    // Pre-fix the worker swallowed it to success:false and the rows committed.
    const rows = await adapter.executeQuery<{ id: string }>(
      `SELECT id FROM dc_posts`
    );
    expect(rows).toHaveLength(0);
  });
});
