// A target collection's field `afterRead` hooks reach rows read through a
// relationship, and see those rows fully assembled.
//
// Expansion may be stricter than a target's own endpoint, never looser. A field
// masked when the collection is read directly has to stay masked when the same
// row arrives nested inside another document.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  group,
  relationship,
  password,
  text,
  upload,
} from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

// Integration files share fixed system-table names, so this suite keeps its own
// slugs to avoid colliding with a concurrently-running file.
const ORGS = "nestedhook_orgs";
const AUTHORS = "nestedhook_authors";
const POSTS = "nestedhook_posts";

// How many times the target's token hook ran, for the selection test.
let tokenHookRuns = 0;

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
          password({ name: "passwordHash" }),
          // Writes a secret back after the fetch stripped it. Only a second
          // strip AFTER the hooks keeps it out of the response.
          text({
            name: "sneaky",
            hooks: {
              afterRead: [
                ({ value, data }) => {
                  (data as Record<string, unknown>).passwordHash = "$2yLEAKED";
                  return value;
                },
              ],
            },
          }),
          text({
            name: "token",
            hooks: {
              afterRead: [
                ({ value }) => {
                  tokenHookRuns++;
                  return typeof value === "string" && value.startsWith("HIDDEN")
                    ? `${value}HIDDEN`
                    : "HIDDEN";
                },
              ],
            },
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
          // The blog template's shape: a relationship to the built-in users
          // entity, which has no dynamic-collection record.
          relationship({ name: "owner", relationTo: "users" }),
          // An upload: its `media` target is a built-in too, but not one
          // `isSystemEntity` knows about.
          upload({ name: "cover", relationTo: "media" }),
          // A relationship inside a container. Expansion populates it, so the
          // walk has to descend through the container to reach it.
          group({
            name: "credits",
            fields: [relationship({ name: "editor", relationTo: AUTHORS })],
          }),
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
    // relations are never expanded on a list at any depth. What this pins is
    // that the walk reaches nested rows on the list path at all.
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

  it("reaches a relationship nested inside a container", async () => {
    // The walk reads a collection's fields; a `group` has no `relationTo` of
    // its own, so a walk that only looked at top-level relationship fields left
    // everything inside a container unmasked.
    const t = await boot();
    await seed(t);
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "credited", credits: { editor: authorId } },
    });

    const listed = await handlerOf(t).listEntries({
      collectionName: POSTS,
      overrideAccess: true,
      depth: 2,
    });
    const withCredits = listed.data!.docs.find(
      d => (d as { title?: string }).title === "credited"
    ) as Record<string, unknown>;
    const credits = withCredits.credits as Record<string, unknown>;
    const editor = credits.editor as Record<string, unknown>;

    expect(editor).toBeTruthy();
    expect(editor.token).toBe("HIDDEN");
  });

  it("transforms a row shared by several parents exactly once", async () => {
    // Batch expansion hands the SAME object to every parent referencing it. A
    // per-entry traversal runs its hooks once per reference, so a transform
    // that is not idempotent compounds with the reference count and every
    // parent sees the compounded value.
    const t = await boot();
    await seed(t);
    const authorId = await onlyId(t, AUTHORS);
    await t.nextly.create({
      collection: POSTS,
      data: { title: "second", author: authorId },
    });

    const listed = await handlerOf(t).listEntries({
      collectionName: POSTS,
      overrideAccess: true,
      depth: 2,
    });

    expect(listed.data!.docs.length).toBeGreaterThan(1);
    for (const doc of listed.data!.docs) {
      const author = (doc as { author?: unknown }).author as Record<
        string,
        unknown
      >;
      // "HIDDEN", not "HIDDENHIDDEN" -- the marker of a second pass.
      expect(author.token).toBe("HIDDEN");
    }
  });

  it("walks a populated system-entity target without failing the read", async () => {
    // `users` has no dynamic-collection record, so the schema lookup finds
    // nothing. Reading that as an untrustworthy lookup and refusing turned an
    // ordinary expansion -- the blog template's `author -> users` -- into an
    // internal error. A system entity registers no field hooks, so there is
    // nothing to fail closed over.
    //
    // Driven through the walk directly with an already-expanded document: that
    // is the state the failure occurs in, and `users` cannot be seeded through
    // the collections API.
    const t = await boot();
    const service = t.getService("relationshipService") as unknown as {
      applyNestedFieldHooks: (
        entry: Record<string, unknown>,
        collection: string,
        access: Record<string, unknown>
      ) => Promise<void>;
    };

    const doc = {
      title: "owned",
      owner: { id: "u1", email: "owner@example.test" },
    };

    await expect(
      service.applyNestedFieldHooks(doc, POSTS, { enforceFieldAccess: true })
    ).resolves.toBeUndefined();
  });
  it("does not look up or log an upload's built-in target", async () => {
    // `media` is not a registered collection, so resolving it costs a metadata
    // query per row only to fail, and logs the failure -- on reads that are
    // otherwise fine. Uploads are close to universal, so that is a query and an
    // error line on most reads in production.
    const t = await boot();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const service = t.getService("relationshipService") as unknown as {
      applyNestedFieldHooks: (
        entry: Record<string, unknown>,
        collection: string,
        access: Record<string, unknown>
      ) => Promise<void>;
    };

    const doc = {
      title: "illustrated",
      cover: { id: "m1", filename: "cover.png" },
    };

    await expect(
      service.applyNestedFieldHooks(doc, POSTS, { enforceFieldAccess: true })
    ).resolves.toBeUndefined();
    // The read succeeding is not enough: it succeeded before this too, after
    // paying for the lookup and shouting about it.
    expect(logged).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });
  it("strips a secret a hook wrote back onto a related row", async () => {
    // The fetch strips a target's password before the hooks run, and a hook on
    // a sibling field can put one back. The response-level defenses sanitize
    // only the ROOT row, using the SOURCE collection's schema, so they never
    // look at this row -- the strip has to happen here.
    const t = await boot();
    await seed(t);
    const postId = await onlyId(t, POSTS);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      overrideAccess: true,
      depth: 2,
    });

    const author = expanded.data!.author as Record<string, unknown>;
    expect(author).toBeTruthy();
    expect(author.passwordHash).toBeUndefined();
  });

  it("does not run a target's hooks for a relationship the caller excluded", async () => {
    // Top-level field hooks run after selection and skip absent fields. A
    // nested target's hooks running for an excluded relationship would fire
    // side effects for a field that is not in the response at all.
    const t = await boot();
    await seed(t);

    tokenHookRuns = 0;
    await handlerOf(t).listEntries({
      collectionName: POSTS,
      overrideAccess: true,
      depth: 2,
      select: { title: true },
    });

    expect(tokenHookRuns).toBe(0);
  });

  it("judges a masking rule on the whole target row, not the projected slice", async () => {
    // Field selection rebuilds each related row as a fresh object holding only
    // the projected paths. A rule masking on a sibling -- here the author's
    // organization -- handed that slice reads `undefined` for its evidence and
    // returns the value unmasked, so asking for exactly the protected field is
    // what gets it.
    const t = await boot();
    const postId = await seed(t);

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      overrideAccess: true,
      depth: 2,
      select: { "author.secret": true },
    });

    const author = expanded.data!.author as Record<string, unknown>;
    expect(author).toBeTruthy();
    expect(author.secret).toBe("REDACTED");
  });

  it("masks a related row before the source collection's own hooks see it", async () => {
    // A source hook can copy a related row's value onto a root property of its
    // own. The traversal masks the nested field it walked, never the copy, so a
    // source hook handed an unmasked target publishes it under a key nothing
    // downstream sanitizes.
    const t = await boot();
    const postId = await seed(t);

    t.hooks.register("afterRead", POSTS, ctx => {
      const entry = ctx.data as Record<string, unknown>;
      const author = entry.author as Record<string, unknown> | undefined;
      entry.leaked = author?.token;
      return entry;
    });

    const expanded = await handlerOf(t).getEntry({
      collectionName: POSTS,
      entryId: postId,
      overrideAccess: true,
      depth: 2,
    });

    // The masked value, not the stored "RAW_TOKEN": the hook was handed a row
    // the target's own protections had already run on.
    expect(expanded.data!.leaked).toBe("HIDDEN");
  });
});
