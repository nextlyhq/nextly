/**
 * A relationship that names several target collections expands like any other.
 *
 * A field whose `relationTo` is a list stores its value as a
 * `{ relationTo, value }` pair rather than a bare id, because the row itself
 * has to say which collection the id belongs to. Expansion handled neither
 * half of that shape: it passed the whole pair to the row loader as if it were
 * an id, and it resolved the target collection from the FIELD's first declared
 * target instead of from the value. The loader's query then bound an object
 * where a string was expected, threw, and the failure was swallowed — so the
 * field came back as its raw pair at every depth, with nothing logged.
 *
 * Pinned against a real database because the failure only appears once a
 * driver rejects the bound parameter.
 */

import { afterEach, expect, it } from "vitest";

import {
  checkbox,
  defineCollection,
  relationship,
  text,
} from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type Handler = CollectionsHandler;

/** `refs.target` may point at either collection, so it stores the pair. */
async function bootPolymorphic(dialect: TestDialect): Promise<{
  handler: Handler;
  postRefId: string;
  pageRefId: string;
}> {
  current = await createTestNextly({
    dialect,
    collections: [
      defineCollection({
        slug: "posts",
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "pages",
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: "refs",
        fields: [
          text({ name: "name" }),
          relationship({ name: "target", relationTo: ["posts", "pages"] }),
        ],
      }),
    ],
  });

  const handler = current.getService<Handler>("collectionsHandler");
  const post = await handler.createEntry(
    { collectionName: "posts", overrideAccess: true },
    { title: "A post" }
  );
  const page = await handler.createEntry(
    { collectionName: "pages", overrideAccess: true },
    { title: "A page" }
  );

  const postRef = await handler.createEntry(
    { collectionName: "refs", overrideAccess: true },
    {
      name: "points at a post",
      target: { relationTo: "posts", value: (post.data as { id: string }).id },
    }
  );
  const pageRef = await handler.createEntry(
    { collectionName: "refs", overrideAccess: true },
    {
      name: "points at a page",
      target: { relationTo: "pages", value: (page.data as { id: string }).id },
    }
  );

  return {
    handler,
    postRefId: (postRef.data as { id: string }).id,
    pageRefId: (pageRef.data as { id: string }).id,
  };
}

async function readTarget(
  handler: Handler,
  entryId: string
): Promise<Record<string, unknown> | undefined> {
  const result = await handler.getEntry({
    collectionName: "refs",
    entryId,
    depth: 1,
    overrideAccess: true,
  });
  return (result.data as { target?: Record<string, unknown> }).target;
}

describeEachDialect("polymorphic relationship expansion", dialect => {
  it("expands a value pointing at the first declared target", async () => {
    const { handler, postRefId } = await bootPolymorphic(dialect);

    const target = await readTarget(handler, postRefId);

    expect(target).toMatchObject({
      relationTo: "posts",
      value: { title: "A post" },
    });
  });

  // The mirror, and the reason the case above is not enough on its own:
  // resolving the target collection from the field's first declared entry
  // would satisfy the "posts" case by accident while sending a "pages" value
  // to the posts table. Only a value that points at a LATER target proves the
  // collection is read from the value.
  it("expands a value pointing at a later declared target", async () => {
    const { handler, pageRefId } = await bootPolymorphic(dialect);

    const target = await readTarget(handler, pageRefId);

    expect(target).toMatchObject({
      relationTo: "pages",
      value: { title: "A page" },
    });
  });

  // The list path batches its fetches instead of loading one row at a time,
  // and resolves the collection separately from the read above — so it needs
  // its own coverage, including a batch that spans both collections at once.
  it("expands values from several collections in one listing", async () => {
    const { handler } = await bootPolymorphic(dialect);

    const result = await handler.listEntries({
      collectionName: "refs",
      depth: 1,
      overrideAccess: true,
    });

    const rows = result.data!.docs as {
      name: string;
      target?: Record<string, unknown>;
    }[];
    const byName = new Map(rows.map(item => [item.name, item.target]));
    expect(byName.get("points at a post")).toMatchObject({
      relationTo: "posts",
      value: { title: "A post" },
    });
    expect(byName.get("points at a page")).toMatchObject({
      relationTo: "pages",
      value: { title: "A page" },
    });
  });

  // Populating spreads the whole related row into the parent, and the row now
  // arrives from whichever collection the value named — so the rules that get
  // evaluated must be that collection's, not the first declared target's.
  it("judges a populated row by its own collection's field rules", async () => {
    current = await createTestNextly({
      dialect,
      collections: [
        defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
        defineCollection({
          slug: "pages",
          fields: [
            text({ name: "title" }),
            checkbox({ name: "hidden", access: { read: () => false } }),
          ],
        }),
        defineCollection({
          slug: "refs",
          fields: [
            text({ name: "name" }),
            relationship({ name: "target", relationTo: ["posts", "pages"] }),
          ],
        }),
      ],
    });

    const handler = current.getService<Handler>("collectionsHandler");
    const page = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "A page", hidden: true }
    );
    const ref = await handler.createEntry(
      { collectionName: "refs", overrideAccess: true },
      {
        name: "r",
        target: {
          relationTo: "pages",
          value: (page.data as { id: string }).id,
        },
      }
    );

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: (ref.data as { id: string }).id,
      depth: 1,
      user: { id: "reader-1" },
      routeAuthorized: true,
    });

    const target = (result.data as { target?: Record<string, unknown> }).target;
    // Expanded, so the rule had something to act on, and the protected field
    // did not survive it.
    expect(target).toMatchObject({
      relationTo: "pages",
      value: { title: "A page" },
    });
    expect(target).not.toHaveProperty("value.hidden");

    // The mirror: without it, the assertion above would hold just as well for
    // a field that never reaches the response at all, and would keep holding
    // if population broke again.
    const trusted = await handler.getEntry({
      collectionName: "refs",
      entryId: (ref.data as { id: string }).id,
      depth: 1,
      overrideAccess: true,
    });
    expect(
      (trusted.data as { target?: Record<string, unknown> }).target
    ).toHaveProperty("value.hidden");
  });

  // Nothing validates the stored slug on the way in, so the value cannot be
  // trusted to name a collection the field ever declared. Honouring it as
  // written turns any writable relationship into a reader for any table.
  it("refuses to populate from a collection the field never declared", async () => {
    current = await createTestNextly({
      dialect,
      collections: [
        defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
        defineCollection({ slug: "pages", fields: [text({ name: "title" })] }),
        defineCollection({
          slug: "secrets",
          fields: [text({ name: "title" }), text({ name: "apiKey" })],
        }),
        defineCollection({
          slug: "refs",
          fields: [
            text({ name: "name" }),
            relationship({ name: "target", relationTo: ["posts", "pages"] }),
          ],
        }),
      ],
    });

    const handler = current.getService<Handler>("collectionsHandler");
    const secret = await handler.createEntry(
      { collectionName: "secrets", overrideAccess: true },
      { title: "Confidential", apiKey: "sk-live-XXXX" }
    );
    const ref = await handler.createEntry(
      { collectionName: "refs", overrideAccess: true },
      {
        name: "smuggled",
        target: {
          relationTo: "secrets",
          value: (secret.data as { id: string }).id,
        },
      }
    );

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: (ref.data as { id: string }).id,
      depth: 1,
      overrideAccess: true,
    });

    // Left exactly as stored: not populated, and above all not carrying a row
    // from a table this field was never pointed at.
    const target = (result.data as { target?: Record<string, unknown> }).target;
    expect(target).toMatchObject({ relationTo: "secrets" });
    expect(target).not.toHaveProperty("apiKey");
  });

  // A populated value is reduced back to a bare id on write unless it still
  // says which collection it came from, and a bare id resolves against the
  // field's first declared target. So reading at depth and saving the document
  // back unchanged has to leave the reference pointing where it did.
  it("survives a read-then-write round trip at depth", async () => {
    const { handler, pageRefId } = await bootPolymorphic(dialect);

    const read = await handler.getEntry({
      collectionName: "refs",
      entryId: pageRefId,
      depth: 1,
      overrideAccess: true,
    });
    const populated = (read.data as { target?: Record<string, unknown> })
      .target;
    expect(populated).toMatchObject({ value: { title: "A page" } });

    // Saved back exactly as it was served, which is what a client editing one
    // other field does.
    await handler.updateEntry(
      { collectionName: "refs", entryId: pageRefId, overrideAccess: true },
      { name: "renamed", target: populated }
    );

    const after = await handler.getEntry({
      collectionName: "refs",
      entryId: pageRefId,
      depth: 1,
      overrideAccess: true,
    });
    // Still the page, not a post and not empty: the target survived the trip.
    expect(
      (after.data as { target?: Record<string, unknown> }).target
    ).toMatchObject({ relationTo: "pages", value: { title: "A page" } });
  });

  // A field's public value is the document id, and a custom validator is
  // written against that. Saving a document read at depth hands the validator
  // the populated row instead, so it compares an object to a string — or calls
  // a string method on it and throws — and rejects an unchanged form.
  it("shows a validator the id when a populated value is saved back", async () => {
    const seen: unknown[] = [];
    current = await createTestNextly({
      dialect,
      collections: [
        defineCollection({ slug: "posts", fields: [text({ name: "title" })] }),
        defineCollection({ slug: "pages", fields: [text({ name: "title" })] }),
        defineCollection({
          slug: "refs",
          fields: [
            text({ name: "name" }),
            relationship({
              name: "target",
              relationTo: ["posts", "pages"],
              validate: (value: unknown) => {
                seen.push(value);
                return true;
              },
            }),
          ],
        }),
      ],
    });

    const handler = current.getService<Handler>("collectionsHandler");
    const page = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "A page" }
    );
    const pageId = (page.data as { id: string }).id;
    const ref = await handler.createEntry(
      { collectionName: "refs", overrideAccess: true },
      { name: "r", target: { relationTo: "pages", value: pageId } }
    );

    const read = await handler.getEntry({
      collectionName: "refs",
      entryId: (ref.data as { id: string }).id,
      depth: 1,
      overrideAccess: true,
    });

    seen.length = 0;
    await handler.updateEntry(
      {
        collectionName: "refs",
        entryId: (ref.data as { id: string }).id,
        overrideAccess: true,
      },
      { name: "renamed", target: (read.data as { target: unknown }).target }
    );

    // The row travelled in; the validator was shown the reference it stands for.
    expect(seen).toContainEqual({ relationTo: "pages", value: pageId });
  });

  it("keeps the pair intact when no expansion was asked for", async () => {
    const { handler, postRefId } = await bootPolymorphic(dialect);

    const result = await handler.getEntry({
      collectionName: "refs",
      entryId: postRefId,
      depth: 0,
      overrideAccess: true,
    });

    // Depth zero asks for references, so the stored pair is the correct
    // answer here — expansion must not be the only way the field round-trips.
    const target = (result.data as { target?: unknown }).target;
    expect(target).toMatchObject({ relationTo: "posts" });
  });
});
