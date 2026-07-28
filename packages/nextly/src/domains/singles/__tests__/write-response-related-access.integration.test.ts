/**
 * A write response is a read of the rows it expands.
 *
 * Updating a Single returns the document, relationships expanded. Those related
 * rows belong to another collection and carry that collection's own field-level
 * `access.read` rules — rules the read paths have evaluated since #335, and
 * which this path did not, because it forwarded no caller.
 *
 * The writer supplied a relationship id, not the related row's protected
 * fields, so "they just wrote it" does not cover them. Leaving the response
 * unredacted makes the write path a way around the rule: write anything, read
 * the response, see what a GET would refuse.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  checkbox,
  defineCollection,
  defineSingle,
  relationship,
  text,
} from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { SingleEntryService } from "../services/single-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** A Single pointing at a collection that hides one of its fields. */
async function boot(): Promise<{
  entry: SingleEntryService;
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
    ],
    singles: [
      defineSingle({
        slug: "branding",
        fields: [
          text({ name: "siteName" }),
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
  return {
    entry: current.getService<SingleEntryService>("singleEntryService"),
    authorId: (author.data as { id: string }).id,
  };
}

describe("single write response — related-row field access (integration)", () => {
  it("withholds a related field the writer may not read", async () => {
    const { entry, authorId } = await boot();

    const result = await entry.update(
      "branding",
      { siteName: "Acme", author: authorId },
      { user: { id: "writer-1" }, routeAuthorized: true }
    );

    expect(result.success).toBe(true);
    const author = (result.data as { author?: Record<string, unknown> })
      ?.author;
    // The relationship is still expanded — only the protected field is gone.
    expect(author).toMatchObject({ name: "Ada" });
    expect(author).not.toHaveProperty("suspended");
  });

  it("withholds a protected field a hop further out", async () => {
    // Nested expansion reaches the related row's own relationships, so the
    // rules of the collection at the far end apply too. Threading the caller
    // into the first hop is only half the answer if it stops there.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "orgs",
          fields: [
            text({ name: "name" }),
            checkbox({ name: "blocked", access: { read: () => false } }),
          ],
        }),
        defineCollection({
          slug: "authors",
          fields: [
            text({ name: "name" }),
            relationship({ name: "org", relationTo: "orgs" }),
          ],
        }),
      ],
      singles: [
        defineSingle({
          slug: "branding",
          fields: [
            text({ name: "siteName" }),
            relationship({ name: "author", relationTo: "authors" }),
          ],
        }),
      ],
    });
    const handler =
      current.getService<CollectionsHandler>("collectionsHandler");
    const org = await handler.createEntry(
      { collectionName: "orgs", overrideAccess: true },
      { name: "Acme", blocked: true }
    );
    const author = await handler.createEntry(
      { collectionName: "authors", overrideAccess: true },
      { name: "Ada", org: (org.data as { id: string }).id }
    );
    const entry = current.getService<SingleEntryService>("singleEntryService");

    const result = await entry.update(
      "branding",
      { siteName: "Acme", author: (author.data as { id: string }).id },
      { user: { id: "writer-1" }, routeAuthorized: true }
    );

    expect(result.success).toBe(true);
    const nested = (
      result.data as { author?: { org?: Record<string, unknown> } }
    )?.author?.org;
    expect(nested).toMatchObject({ name: "Acme" });
    expect(nested).not.toHaveProperty("blocked");
  });

  it("leaves a trusted write's response whole", async () => {
    // The mirror, and the reason enforcement is not simply switched on
    // everywhere: a trusted write supplies no caller to judge, and stripping
    // there would hide fields from an internal writer that nothing denied.
    const { entry, authorId } = await boot();

    const result = await entry.update(
      "branding",
      { siteName: "Acme", author: authorId },
      { overrideAccess: true }
    );

    expect(result.success).toBe(true);
    const author = (result.data as { author?: Record<string, unknown> })
      ?.author;
    expect(author).toMatchObject({ name: "Ada", suspended: true });
  });
});
