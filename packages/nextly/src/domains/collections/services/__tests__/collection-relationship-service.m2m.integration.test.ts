/**
 * End-to-end proof that many-to-many relationships work through the real
 * junction-table DDL, insert, and delete path. This test only passes when
 * all three of these fixes hold together:
 *
 *   1. `generateJunctionTable()` emits valid, single-statement DDL (no
 *      orphaned CONSTRAINT fragment) — otherwise seeding the junction table
 *      itself throws and this test never gets past setup.
 *   2. `getTargetCollection()` falls back to `field.options.target` — a
 *      Builder-authored (UI) manyToMany field never sets `relationTo`, so
 *      without this fallback `insertManyToManyRelations` logs "cannot
 *      determine target" and silently no-ops (no row, no thrown error).
 *   3. `insertManyToManyRelations` binds the junction `created_at` as an
 *      epoch-seconds integer on SQLite instead of a `Date` — better-sqlite3
 *      rejects a bound `Date` outright, so without this fix the insert
 *      throws "Failed to insert all manyToMany relations" on SQLite.
 *
 * Code-first collections cannot express many-to-many (the typed
 * `relationship()` helper only supports `hasMany`), so this suite builds a
 * REAL junction table via `seedBuilderCollection` (the Schema-Builder path).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FieldDefinition } from "@nextly/schemas/dynamic-collections";

import { clearServices } from "../../../../di/register";
import { seedBuilderCollection } from "../../../../plugins/__tests__/seed-builder-entity";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { CollectionRelationshipService } from "../collection-relationship-service";

// Raw FieldDefinition m2m shape — the typed relationship() helper cannot
// express manyToMany, so the field is authored directly as the Builder would
// store it (target on options.target, not on relationTo).
const m2mField = {
  name: "tags",
  type: "relationship",
  options: { relationType: "manyToMany", target: "tags" },
} as unknown as FieldDefinition;

let handle: TestNextly | undefined;

afterEach(async () => {
  await handle?.destroy();
  handle = undefined;
});

/**
 * Recipe: seed the target collection (`tags`) then the source collection
 * (`posts`, carrying the m2m field) on a first boot — seeding emits the real
 * junction table DDL (`dc_posts_dc_tags_tags`). Reset DI without disconnecting
 * the in-memory adapter, then reboot on the SAME adapter so the seeded
 * collections' "relationshipService" (needed below) is reachable through DI.
 */
async function seedTagsAndPosts(): Promise<{
  rel: CollectionRelationshipService;
  tagId: string;
  postId: string;
}> {
  handle = await createTestNextly({});
  const adapter = handle.adapter;

  // Target seeded BEFORE source: the junction table's FK references dc_tags,
  // so dc_tags must already exist when the posts migration creates the
  // junction table.
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

  // "relationshipService" is registered as a side effect of resolving
  // "collectionService" (its factory wires up + registers the relationship
  // service instance it composes) — force that resolution before fetching it.
  handle.getService("collectionService");
  const rel = handle.getService("relationshipService");

  const tagId = "tag-1";
  const postId = "post-1";
  // Seed via raw SQL, not adapter.insert(): a manyToMany field is not
  // represented on the runtime Drizzle table object for dc_posts (it has no
  // parent column — see field-column-descriptor's "skip" classification), so
  // there is no typed column to insert through. Raw SQL bypasses that
  // entirely and writes straight to the physical columns the DDL created.
  //
  // Values are inlined as literals (no $1/? placeholders): node-postgres
  // expects `$1`, mysql2 expects `?`, and the adapter only rewrites `$1`
  // style for SQLite (see SqliteAdapter.convertPlaceholders) — there is no
  // single placeholder syntax that all three dialect drivers accept via
  // executeQuery. Table/column names are unquoted since none are reserved
  // words, matching the identifier style existing dialect-matrix integration
  // suites (e.g. seed-system-permissions.integration.test.ts) use.
  const nowEpoch = Math.floor(Date.now() / 1000);
  await adapter.executeQuery(
    `INSERT INTO dc_tags (id, title, slug, name, created_at, updated_at) VALUES ('${tagId}', 'JavaScript', 'javascript', 'javascript', ${nowEpoch}, ${nowEpoch})`
  );
  await adapter.executeQuery(
    `INSERT INTO dc_posts (id, title, slug, created_at, updated_at) VALUES ('${postId}', 'Hello', 'hello', ${nowEpoch}, ${nowEpoch})`
  );

  return { rel, tagId, postId };
}

describe("CollectionRelationshipService many-to-many junction writes (integration)", () => {
  let rel: CollectionRelationshipService;
  let tagId: string;
  let postId: string;

  beforeEach(async () => {
    ({ rel, tagId, postId } = await seedTagsAndPosts());
  });

  it("insertManyToManyRelations creates a junction row linking post to tag", async () => {
    const adapter = handle!.adapter;

    await rel.insertManyToManyRelations("posts", postId, m2mField, [tagId]);

    // The junction table isn't a registered dynamic collection, so
    // `adapter.select` can't resolve it; query it directly instead.
    const rows = await adapter.executeQuery<{
      id: string;
      posts_id: string;
      tags_id: string;
    }>(
      `SELECT id, posts_id, tags_id FROM dc_posts_dc_tags_tags WHERE posts_id = '${postId}'`
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].posts_id).toBe(postId);
    expect(rows[0].tags_id).toBe(tagId);
  });

  it("fetchManyToManyRelationsBatch resolves the linked tag through the target-fallback lookup", async () => {
    await rel.insertManyToManyRelations("posts", postId, m2mField, [tagId]);

    const dataMap = await rel.batchFetchManyToManyRelations(
      "posts",
      [postId],
      m2mField
    );

    const related = dataMap.get(postId);
    expect(related).toBeDefined();
    expect(related).toHaveLength(1);
    expect(related?.[0].id).toBe(tagId);
  });

  it("expandRelationships populates m2m links on a single-entry read", async () => {
    await rel.insertManyToManyRelations("posts", postId, m2mField, [tagId]);

    // The single-entry expansion path (findById / create+update responses at
    // depth > 0) must populate m2m links even though a m2m field has no
    // parent-row value — its links live only in the junction table, keyed by
    // entry.id. A row-value guard here would wrongly skip the field.
    const entry = { id: postId, title: "Hello", slug: "hello" };
    const expanded = await rel.expandRelationships(entry, "posts", [m2mField], {
      depth: 1,
    });

    const tags = expanded.tags as Array<{ id: string }> | undefined;
    expect(tags).toBeDefined();
    expect(tags).toHaveLength(1);
    expect(tags?.[0].id).toBe(tagId);
  });

  it("deleteManyToManyRelations removes the junction row", async () => {
    const adapter = handle!.adapter;

    await rel.insertManyToManyRelations("posts", postId, m2mField, [tagId]);

    const before = await adapter.executeQuery<{ id: string }>(
      `SELECT id FROM dc_posts_dc_tags_tags WHERE posts_id = '${postId}'`
    );
    expect(before).toHaveLength(1);

    await rel.deleteManyToManyRelations("posts", postId, m2mField);

    const after = await adapter.executeQuery<{ id: string }>(
      `SELECT id FROM dc_posts_dc_tags_tags WHERE posts_id = '${postId}'`
    );
    expect(after).toHaveLength(0);
  });
});
