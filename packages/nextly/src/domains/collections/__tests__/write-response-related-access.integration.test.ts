/**
 * A collection's write response applies the related row's own field rules.
 *
 * Creating or updating an entry at a populating depth returns the document with
 * its relationships expanded. Those rows belong to another collection and carry
 * that collection's field-level `access.read` rules; the response redaction runs
 * against the SOURCE collection's schema and so cannot reach inside a populated
 * row. Without the caller travelling into expansion, the write path answers a
 * question a GET would refuse: write anything, read the response, see the field.
 *
 * The writer supplied a relationship id, not the related row's protected
 * columns, so "they just wrote it" does not cover them.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  checkbox,
  defineCollection,
  relationship,
  text,
} from "../../../config";
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

async function boot(): Promise<{
  handler: CollectionsHandler;
  authorId: string;
}> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "authors",
        fields: [
          text({ name: "name" }),
          checkbox({ name: "suspended", access: { read: () => false } }),
        ],
      }),
      defineCollection({
        slug: "posts",
        fields: [
          text({ name: "title" }),
          relationship({ name: "author", relationTo: "authors" }),
        ],
      }),
    ],
  });

  const handler = current.getService<CollectionsHandler>("collectionsHandler");
  const author = await handler.createEntry(
    { collectionName: "authors", overrideAccess: true },
    { name: "Ada", suspended: true }
  );
  return { handler, authorId: (author.data as { id: string }).id };
}

describe("collection write response — related-row field access (integration)", () => {
  it("withholds a related field the creator may not read", async () => {
    const { handler, authorId } = await boot();

    const result = await handler.createEntry(
      {
        collectionName: "posts",
        user: { id: "writer-1" },
        routeAuthorized: true,
        depth: 1,
      },
      { title: "Hello", author: authorId }
    );

    expect(result.success).toBe(true);
    const author = (result.data as { author?: Record<string, unknown> }).author;
    // Expanded, so the rule had a row to act on, and the protected field did
    // not survive it.
    expect(author).toMatchObject({ name: "Ada" });
    expect(author).not.toHaveProperty("suspended");
  });

  it("withholds it on update too", async () => {
    const { handler, authorId } = await boot();

    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "Hello", author: authorId }
    );

    const result = await handler.updateEntry(
      {
        collectionName: "posts",
        entryId: (created.data as { id: string }).id,
        user: { id: "writer-1" },
        routeAuthorized: true,
        depth: 1,
      },
      { title: "Hello again" }
    );

    expect(result.success).toBe(true);
    const author = (result.data as { author?: Record<string, unknown> }).author;
    expect(author).toMatchObject({ name: "Ada" });
    expect(author).not.toHaveProperty("suspended");
  });

  // The mirror, and the reason the cases above are not enough on their own:
  // enforcing without a caller judges everyone anonymous and strips the field
  // from entitled callers too, so a passing leak test says nothing about
  // whether a trusted write still returns the whole row.
  it("still returns the whole row to a trusted write", async () => {
    const { handler, authorId } = await boot();

    const result = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true, depth: 1 },
      { title: "Hello", author: authorId }
    );

    expect(
      (result.data as { author?: Record<string, unknown> }).author
    ).toHaveProperty("suspended");
  });
});
