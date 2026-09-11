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
