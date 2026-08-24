/**
 * A field a caller may not READ must not be a field it can FILTER on.
 *
 * Redaction runs on rows that have already been selected, so it can remove a
 * value from a row and cannot un-select the row. If a `where` on a denied field
 * still reaches the database, the caller never sees the value and still learns
 * it: ask for `equals` each candidate and watch which query returns the row.
 *
 * Against a real (in-memory SQLite) database, because the claim is about what
 * SQL the query actually runs. A mocked query builder would only restate the
 * call the test itself made.
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";

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
  createEntry: (
    p: Record<string, unknown>,
    data: Record<string, unknown>
  ) => Promise<{
    success: boolean;
    data: Record<string, unknown> | null;
  }>;
};

const VAULTS = "vaults";

async function boot(): Promise<TestNextly> {
  const t = await createTestNextly({
    collections: [
      defineCollection({
        slug: VAULTS,
        // The collection is readable; only the one field is not. That is the
        // shape a field rule exists for -- "you may see these rows, not this
        // column" -- and the shape this test is about.
        access: { read: () => true, create: () => true, update: () => true },
        fields: [
          text({ name: "title" }),
          text({ name: "codename", access: { read: () => false } }),
        ],
      }),
    ],
  });

  const h = t.getService("collectionsHandler") as unknown as ReadHandler;
  await h.createEntry(
    { collectionName: VAULTS, overrideAccess: true },
    { title: "north", codename: "alpha" }
  );
  await h.createEntry(
    { collectionName: VAULTS, overrideAccess: true },
    { title: "south", codename: "beta" }
  );
  return t;
}

describe("a denied field and the where clause (integration)", () => {
  it("hides the field from the reader", async () => {
    // The control. Without it the test below proves nothing: if the field were
    // readable, filtering on it would be entirely correct behaviour.
    current = await boot();
    const h = current.getService(
      "collectionsHandler"
    ) as unknown as ReadHandler;

    const listed = await h.listEntries({
      collectionName: VAULTS,
      overrideAccess: false,
    });

    expect(listed.success).toBe(true);
    expect(listed.data!.docs).toHaveLength(2);
    for (const doc of listed.data!.docs) {
      expect(doc.title).toBeDefined();
      expect(doc.codename).toBeUndefined();
    }
  });

  it("refuses a where that names the denied field", async () => {
    current = await boot();
    const h = current.getService(
      "collectionsHandler"
    ) as unknown as ReadHandler;

    // The fixture control. If the values never reached the column, every query
    // returns nothing, two empty answers agree, and a broken fixture reads as a
    // guard that works. Measured: this exact test passed by emptiness before the
    // create call was corrected.
    const stored = await h.listEntries({
      collectionName: VAULTS,
      overrideAccess: true,
    });
    expect(stored.data!.docs.map(d => d.codename).sort()).toEqual([
      "alpha",
      "beta",
    ]);

    const refused = await h.listEntries({
      collectionName: VAULTS,
      overrideAccess: false,
      where: { codename: { equals: "alpha" } },
    });

    // Refused rather than silently widened. A filter that is dropped returns
    // MORE rows than asked for, which is safe and lies to the caller; naming the
    // field discloses only that it is restricted, which its absence from every
    // response already says.
    expect(refused.success).toBe(false);
    expect(JSON.stringify(refused)).toContain("FIELD_NOT_FILTERABLE");
  });

  it("still filters on a field the caller may read", async () => {
    // The negative control. A guard that refused every filter would pass the
    // test above and break the product.
    current = await boot();
    const h = current.getService(
      "collectionsHandler"
    ) as unknown as ReadHandler;

    const listed = await h.listEntries({
      collectionName: VAULTS,
      overrideAccess: false,
      where: { title: { equals: "north" } },
    });

    expect(listed.success).toBe(true);
    expect(listed.data!.docs.map(d => String(d.title))).toEqual(["north"]);
  });

  it("lets a trusted caller filter on it", async () => {
    // `overrideAccess` means the caller has already decided who is asking, and
    // internal reads legitimately filter on fields no end user may see.
    current = await boot();
    const h = current.getService(
      "collectionsHandler"
    ) as unknown as ReadHandler;

    const listed = await h.listEntries({
      collectionName: VAULTS,
      overrideAccess: true,
      where: { codename: { equals: "alpha" } },
    });

    expect(listed.success).toBe(true);
    expect(listed.data!.docs.map(d => String(d.title))).toEqual(["north"]);
  });
});
