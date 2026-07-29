/**
 * Relationship expansion reaches a second hop for every collection, not only
 * for those the Schema Builder created.
 *
 * `expandRelationships` recurses while depth remains, but it only does so when
 * it can resolve the target collection's fields. That resolution read
 * `schemaDefinition.fields` alone, which a Builder-created collection carries
 * and a code-first one does not — its fields sit at the top level of the stored
 * row. So a code-first collection resolved to no fields, the recursion guard
 * failed, and the second hop was silently skipped at any depth.
 *
 * Two things rode on that, which is why this is pinned against a real database:
 * a `?depth=2` read returned a bare id where it promised a document, and an
 * access rule reading across two hops was enforced for one kind of collection
 * and quietly unenforced for the other.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, relationship, text } from "../../../config";
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

type Handler = CollectionsHandler;

/** posts -> author -> org, all declared in code. */
async function bootChain(): Promise<{ handler: Handler; postId: string }> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "orgs",
        fields: [text({ name: "name" })],
      }),
      defineCollection({
        slug: "authors",
        fields: [
          text({ name: "name" }),
          relationship({ name: "org", relationTo: "orgs" }),
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

  const handler = current.getService<Handler>("collectionsHandler");
  const org = await handler.createEntry(
    { collectionName: "orgs", overrideAccess: true },
    { name: "Acme" }
  );
  const author = await handler.createEntry(
    { collectionName: "authors", overrideAccess: true },
    { name: "Ada", org: (org.data as { id: string }).id }
  );
  const post = await handler.createEntry(
    { collectionName: "posts", overrideAccess: true },
    { title: "Hello", author: (author.data as { id: string }).id }
  );
  return { handler, postId: (post.data as { id: string }).id };
}

describe("nested relationship expansion (integration)", () => {
  it("expands the second hop of a code-first chain", async () => {
    const { handler, postId } = await bootChain();

    const result = await handler.getEntry({
      collectionName: "posts",
      entryId: postId,
      depth: 2,
      overrideAccess: true,
    });

    const author = (result.data as { author?: Record<string, unknown> }).author;
    expect(author).toMatchObject({ name: "Ada" });
    // The hop that was silently skipped: `org` came back as its id.
    expect(author?.org).toMatchObject({ name: "Acme" });
  });

  it("still stops where the requested depth stops", async () => {
    // The mirror. Recursion is bounded by depth, and restoring it must not make
    // expansion unbounded — a `depth: 1` read asks for one hop and gets one.
    const { handler, postId } = await bootChain();

    const result = await handler.getEntry({
      collectionName: "posts",
      entryId: postId,
      depth: 1,
      overrideAccess: true,
    });

    const author = (result.data as { author?: Record<string, unknown> }).author;
    expect(author).toMatchObject({ name: "Ada" });
    expect(typeof author?.org).toBe("string");
  });
});
