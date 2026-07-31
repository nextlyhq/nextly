// A target collection's field `afterRead` hooks reach rows read through a
// relationship, and see those rows fully assembled.
//
// Expansion may be stricter than a target's own endpoint, never looser. A field
// masked when the collection is read directly has to stay masked when the same
// row arrives nested inside another document.

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, relationship, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Integration files share fixed system-table names, so this suite keeps its own
// slugs to avoid colliding with a concurrently-running file.
const ORGS = "nestedhook_orgs";
const AUTHORS = "nestedhook_authors";
const POSTS = "nestedhook_posts";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type ReadHandler = {
  listEntries: (p: Record<string, unknown>) => Promise<{
    success: boolean;
    data: { docs: Record<string, unknown>[] } | null;
  }>;
  getEntry: (p: Record<string, unknown>) => Promise<{
    success: boolean;
    data: Record<string, unknown> | null;
  }>;
};

function handlerOf(t: TestNextly) {
  return t.getService("collectionsHandler") as unknown as ReadHandler;
}

async function onlyId(t: TestNextly, collection: string): Promise<string> {
  const listed = await handlerOf(t).listEntries({
    collectionName: collection,
    overrideAccess: true,
  });
  return String(listed.data!.docs[0].id);
}

async function boot(): Promise<TestNextly> {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: ORGS,
        fields: [text({ name: "name" }), text({ name: "classification" })],
      }),
      defineCollection({
        slug: AUTHORS,
        fields: [
          text({ name: "name" }),
          relationship({ name: "organization", relationTo: ORGS }),
          // Masks based on the author's OWN relationship. At fetch time that
          // is still a raw id, so a hook run then reads `undefined` and lets
          // the secret through; only a fully assembled row masks correctly.
          // Masks unconditionally, so it is testable on the list path too --
          // batch expansion does not recurse into a related row's OWN
          // relationships, so a hook needing that evidence cannot mask there.
          text({
            name: "token",
            hooks: { afterRead: [() => "HIDDEN"] },
          }),
          text({
            name: "secret",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  const org = (data as { organization?: unknown }).organization;
                  const classification =
                    typeof org === "object" && org !== null
                      ? (org as { classification?: unknown }).classification
                      : undefined;
                  return classification === "private" ? "REDACTED" : value;
                },
              ],
            },
          }),
        ],
      }),
      defineCollection({
        slug: POSTS,
        fields: [
          text({ name: "title" }),
          relationship({ name: "author", relationTo: AUTHORS }),
        ],
      }),
    ],
  });
  return current;
}

async function seed(t: TestNextly): Promise<string> {
  await t.nextly.create({
    collection: ORGS,
    data: { name: "acme", classification: "private" },
  });
  const orgId = await onlyId(t, ORGS);
  await t.nextly.create({
    collection: AUTHORS,
    data: {
      name: "ada",
      organization: orgId,
      secret: "TOP_SECRET",
      token: "RAW_TOKEN",
    },
  });
  const authorId = await onlyId(t, AUTHORS);
  await t.nextly.create({
    collection: POSTS,
    data: { title: "p", author: authorId },
  });
  return await onlyId(t, POSTS);
}

describe("a target's field hooks apply to rows reached through a relationship", () => {
  it("masks on the target's own endpoint", async () => {
    // The control. Without it, a masked value through a relationship could
    // just as well mean the hook masks unconditionally.
    const t = await boot();
    await seed(t);
    const authorId = await onlyId(t, AUTHORS);

    const direct = await handlerOf(t).getEntry({
      collectionName: AUTHORS,
      entryId: authorId,
      overrideAccess: true,
      depth: 1,
    });

    expect(direct.data!.secret).toBe("REDACTED");
  });

  it("masks the same row when it arrives nested in another document", async () => {
    const t = await boot();
    const postId = await seed(t);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      overrideAccess: true,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    expect(author).toBeTruthy();
    // The hook masked on the author's OWN relationship, which means it was
    // handed the row after that relationship had been expanded.
    expect(author.secret).toBe("REDACTED");
  });

  it("applies the target's field hooks to nested rows on a list too", async () => {
    // Asserted on a field whose hook needs no further expansion: the batch path
    // skips relationship fields when it recurses, so a related row's own
    // relations are never expanded on a list at any depth. That gap is real and
    // recorded in the spec, but it is not this one -- what matters here is that
    // the walk reaches nested rows on the list path at all.
    const t = await boot();
    await seed(t);

    const listed = await handlerOf(t).listEntries({
      collectionName: POSTS,
      overrideAccess: true,
      depth: 2,
    });

    const author = listed.data!.docs[0].author as Record<string, unknown>;
    expect(author).toBeTruthy();
    expect(author.token).toBe("HIDDEN");
  });

  it("leaves the value alone when the nested evidence does not call for masking", async () => {
    // The mirror: the hook is reading real data, not masking everything it
    // touches. Without this the fix could be a hook that always redacts.
    const t = await boot();
    await t.nextly.create({
      collection: ORGS,
      data: { name: "open", classification: "public" },
    });
    const orgId = await onlyId(t, ORGS);
    await t.nextly.create({
      collection: AUTHORS,
      data: { name: "bob", organization: orgId, secret: "VISIBLE" },
    });
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "open post", author: authorId },
    });
    const postId = await onlyId(t, POSTS);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      overrideAccess: true,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    expect(author.secret).toBe("VISIBLE");
  });
});
