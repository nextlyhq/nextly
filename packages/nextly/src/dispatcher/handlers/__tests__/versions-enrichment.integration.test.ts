/**
 * Version reads return data a person can read: the display name of whoever
 * wrote each version, and relationship values resolved to labels rather than
 * the ids actually stored.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text, relationship } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import {
  getVersionForDocument,
  listVersionsForDocument,
} from "../versions-methods";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function bootWithAuthorRelation(): Promise<TestNextly> {
  return createTestNextly({
    collections: [
      defineCollection({
        slug: "authors",
        fields: [text({ name: "name" })],
      }),
      defineCollection({
        slug: "posts",
        versions: true,
        fields: [
          text({ name: "title" }),
          relationship({ name: "writtenBy", relationTo: "authors" }),
        ],
      }),
    ],
  });
}

describe("version read enrichment (integration)", () => {
  it("resolves a relationship id in the snapshot to an id and label", async () => {
    current = await bootWithAuthorRelation();
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const author = await handler.createEntry(
      { collectionName: "authors", overrideAccess: true },
      { name: "Ada Lovelace" }
    );
    const authorId = (author.data as { id: string }).id;

    const post = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "First", writtenBy: authorId }
    );
    const postId = (post.data as { id: string }).id;

    const version = await getVersionForDocument({
      scopeKind: "collection",
      slug: "posts",
      entryId: postId,
      user: { id: "system", roles: ["super-admin"] },
      versionNo: 1,
    });

    const snapshot = version.snapshot as Record<string, unknown>;
    // The stored value is a bare id; the read path is what makes it legible.
    expect(snapshot.writtenBy).toEqual({
      id: authorId,
      label: "Ada Lovelace",
    });
  });

  it("returns an author field on every listed version", async () => {
    current = await bootWithAuthorRelation();
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const post = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "First" }
    );
    const postId = (post.data as { id: string }).id;

    const result = await listVersionsForDocument({
      scopeKind: "collection",
      slug: "posts",
      entryId: postId,
      user: { id: "system", roles: ["super-admin"] },
    });

    expect(result.items.length).toBeGreaterThan(0);
    // Written without an authenticated user, so attribution is absent rather
    // than missing from the shape entirely — the drawer renders the field.
    for (const item of result.items) {
      expect(item).toHaveProperty("author");
    }
  });

  it("leaves a snapshot untouched when the document has no references", async () => {
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "notes",
          versions: true,
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");

    const note = await handler.createEntry(
      { collectionName: "notes", overrideAccess: true },
      { title: "Plain" }
    );
    const noteId = (note.data as { id: string }).id;

    const version = await getVersionForDocument({
      scopeKind: "collection",
      slug: "notes",
      entryId: noteId,
      user: { id: "system", roles: ["super-admin"] },
      versionNo: 1,
    });

    expect((version.snapshot as Record<string, unknown>).title).toBe("Plain");
  });
});
