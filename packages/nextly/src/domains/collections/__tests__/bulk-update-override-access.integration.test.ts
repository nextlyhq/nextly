/**
 * A trusted batch update has a trusted path.
 *
 * `createEntries` took `overrideAccess` and `updateEntries` did not, so a
 * plugin's `updateMany(..., { as: "system" })` or a seed's batch update was
 * judged as an anonymous caller at the collection gate and refused every row
 * on a collection whose update rule wants a user. Asserted through a booted
 * instance with such a rule, both ways: elevated succeeds, and the same batch
 * without elevation is refused, so the parameter cannot be a no-op.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionEntryService } from "../../../services/collections/collection-entry-service";

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot() {
  current = await createTestNextly({
    collections: [
      defineCollection({
        slug: "notes",
        access: {
          create: () => true,
          read: () => true,
          // Anyone signed in may update; nobody anonymous may.
          update: ({ user }) => Boolean(user),
        },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  // Keyed by service NAME: `ServiceMap` already maps it to its type.
  const handler = current.getService("collectionsHandler");
  const entries = handler.getEntryService() as CollectionEntryService;
  const created = await handler.createEntry(
    { collectionName: "notes", overrideAccess: true },
    { title: "before" }
  );
  const id = (created.data as { id: string }).id;
  return { handler, entries, id };
}

describe("bulk update honours overrideAccess (integration)", () => {
  it("updates without a user when elevated", async () => {
    const { handler, entries, id } = await boot();

    const result = await entries.updateEntries(
      { collectionName: "notes", overrideAccess: true },
      [{ id, data: { title: "after" } }]
    );

    expect(result.errors).toEqual([]);
    expect(result.successful).toBe(1);
    const read = await handler.getEntry({
      collectionName: "notes",
      entryId: id,
      overrideAccess: true,
    });
    expect((read.data as { title?: string })?.title).toBe("after");
  });

  it("publishes past a refusing publish rule when elevated", async () => {
    // Passes the collection gate (update allows everyone) so the batch reaches
    // the transition pre-resolve, which is what must be told about the
    // elevation; a gate-only forwarding leaves it refusing.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "posts",
          status: true,
          access: {
            create: () => true,
            read: () => true,
            update: () => true,
            publish: () => false,
          },
          fields: [text({ name: "title" })],
        }),
      ],
    });
    const handler = current.getService("collectionsHandler");
    const entries = handler.getEntryService() as CollectionEntryService;
    const created = await handler.createEntry(
      { collectionName: "posts", overrideAccess: true },
      { title: "draft", status: "draft" }
    );
    const id = (created.data as { id: string }).id;

    const refused = await entries.updateEntries({ collectionName: "posts" }, [
      { id, data: { status: "published" } },
    ]);
    expect(refused.successful).toBe(0);
    expect(refused.failed).toBe(1);

    const elevated = await entries.updateEntries(
      { collectionName: "posts", overrideAccess: true },
      [{ id, data: { status: "published" } }]
    );
    expect(elevated.errors).toEqual([]);
    expect(elevated.successful).toBe(1);
    const read = await handler.getEntry({
      collectionName: "posts",
      entryId: id,
      overrideAccess: true,
    });
    expect((read.data as { status?: string })?.status).toBe("published");
  });

  it("writes a field whose own rule refuses the caller when elevated", async () => {
    // Passes the collection gate and the transition; only the per-entry write
    // judges the field rule. Without the flag reaching the worker the field
    // is dropped from the write and the row keeps its old value.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          access: { create: () => true, read: () => true, update: () => true },
          fields: [
            text({ name: "title" }),
            text({
              name: "internalNote",
              access: { update: ({ req }) => Boolean(req.user) },
            }),
          ],
        }),
      ],
    });
    const handler = current.getService("collectionsHandler");
    const entries = handler.getEntryService() as CollectionEntryService;
    const created = await handler.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "t", internalNote: "before" }
    );
    const id = (created.data as { id: string }).id;

    const unelevated = await entries.updateEntries(
      { collectionName: "pages" },
      [{ id, data: { internalNote: "after" } }]
    );
    // The row write is allowed and the protected field is stripped from it,
    // leaving an empty patch, which updates the row's timestamp and nothing
    // else. Counted, not just error-free: a row skipped without being
    // accounted for would also report no errors.
    expect(unelevated.errors).toEqual([]);
    expect(unelevated.successful).toBe(1);
    expect(unelevated.failed).toBe(0);
    expect(unelevated.ids).toEqual([id]);
    let read = await handler.getEntry({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
    });
    expect((read.data as { internalNote?: string })?.internalNote).toBe(
      "before"
    );

    const elevated = await entries.updateEntries(
      { collectionName: "pages", overrideAccess: true },
      [{ id, data: { internalNote: "after" } }]
    );
    expect(elevated.errors).toEqual([]);
    read = await handler.getEntry({
      collectionName: "pages",
      entryId: id,
      overrideAccess: true,
    });
    expect((read.data as { internalNote?: string })?.internalNote).toBe(
      "after"
    );
  });

  it("still refuses the same batch without elevation", async () => {
    // The control: an implementation that ignored the gate entirely would
    // pass the case above. The rule wants a user and this call has none.
    const { handler, entries, id } = await boot();

    const result = await entries.updateEntries({ collectionName: "notes" }, [
      { id, data: { title: "after" } },
    ]);

    expect(result.successful).toBe(0);
    expect(result.failed).toBe(1);
    const read = await handler.getEntry({
      collectionName: "notes",
      entryId: id,
      overrideAccess: true,
    });
    expect((read.data as { title?: string })?.title).toBe("before");
  });
});
