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
  countEntries: (p: Record<string, unknown>) => Promise<{
    success: boolean;
    data: unknown;
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

  it("refuses the same filter on a count", async () => {
    // A count is a CLEANER oracle than a listing, not a lesser one: it answers
    // 1 or 0 for a guessed value and hands back no row to redact, so a guard
    // that covered only the listing would leave the shorter path open.
    current = await boot();
    const h = current.getService(
      "collectionsHandler"
    ) as unknown as ReadHandler;

    const refused = await h.countEntries({
      collectionName: VAULTS,
      overrideAccess: false,
      where: { codename: { equals: "alpha" } },
    });

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

  it("lets the framework address a row by a field it built the filter for", async () => {
    // The route's own lookup. Without this the guard would refuse every
    // enforced page resolution on a site that puts a read rule on its slug
    // field, turning a security fix into a site-wide 404.
    current = await boot();
    const h = current.getService(
      "collectionsHandler"
    ) as unknown as ReadHandler;

    const listed = await h.listEntries({
      collectionName: VAULTS,
      overrideAccess: false,
      where: { codename: { equals: "alpha" } },
      frameworkFilter: true,
    });

    expect(listed.success).toBe(true);
    expect(listed.data!.docs.map(d => String(d.title))).toEqual(["north"]);
  });

  it("still redacts the field the framework filtered on", async () => {
    // The exemption is about which rows may be SELECTED, and must not become a
    // second way to read the value. If addressing by a field also revealed it,
    // this would have traded one disclosure for another.
    current = await boot();
    const h = current.getService(
      "collectionsHandler"
    ) as unknown as ReadHandler;

    const listed = await h.listEntries({
      collectionName: VAULTS,
      overrideAccess: false,
      where: { codename: { equals: "alpha" } },
      frameworkFilter: true,
    });

    expect(listed.data!.docs[0].codename).toBeUndefined();
    expect(listed.data!.docs[0].title).toBe("north");
  });

  it("refuses to SORT by the denied field", async () => {
    // Ordering leaks the same value more slowly. The rows come back redacted
    // and their ORDER is a comparison of the hidden column, so a caller who can
    // create rows with chosen anchors can bisect a neighbour's value from where
    // it lands between them.
    current = await boot();
    const h = current.getService(
      "collectionsHandler"
    ) as unknown as ReadHandler;

    const refused = await h.listEntries({
      collectionName: VAULTS,
      overrideAccess: false,
      sort: "codename",
    });

    expect(refused.success).toBe(false);
    expect(JSON.stringify(refused)).toContain("FIELD_NOT_SORTABLE");
  });

  it("refuses a descending sort by the denied field too", async () => {
    // `-field` is the same field. A guard keyed on the raw string would pass
    // this and leave the identical leak open one character away.
    current = await boot();
    const h = current.getService(
      "collectionsHandler"
    ) as unknown as ReadHandler;

    const refused = await h.listEntries({
      collectionName: VAULTS,
      overrideAccess: false,
      sort: "-codename",
    });

    expect(refused.success).toBe(false);
    expect(JSON.stringify(refused)).toContain("FIELD_NOT_SORTABLE");
  });

  it("still sorts by a field the caller may read", async () => {
    // The negative control: a guard that refused every sort would pass the two
    // tests above and break every listing in the product.
    current = await boot();
    const h = current.getService(
      "collectionsHandler"
    ) as unknown as ReadHandler;

    const listed = await h.listEntries({
      collectionName: VAULTS,
      overrideAccess: false,
      sort: "title",
    });

    expect(listed.success).toBe(true);
    expect(listed.data!.docs.map(d => String(d.title))).toEqual([
      "north",
      "south",
    ]);
  });

  it("does not match the denied field when searching", async () => {
    // Search is NARROWED rather than refused: the caller named no column, so
    // dropping the ones they may not read answers exactly what they asked.
    // Leaving them in lets `search=alpha` probe the hidden value through which
    // rows come back.
    current = await boot();
    const h = current.getService(
      "collectionsHandler"
    ) as unknown as ReadHandler;

    const hit = await h.listEntries({
      collectionName: VAULTS,
      overrideAccess: false,
      search: "alpha",
    });

    expect(hit.success).toBe(true);
    expect(hit.data!.docs.map(d => String(d.title))).toEqual([]);
  });

  it("still searches the fields the caller may read", async () => {
    // The negative control for search: narrowing must not empty it.
    current = await boot();
    const h = current.getService(
      "collectionsHandler"
    ) as unknown as ReadHandler;

    const hit = await h.listEntries({
      collectionName: VAULTS,
      overrideAccess: false,
      search: "north",
    });

    expect(hit.success).toBe(true);
    expect(hit.data!.docs.map(d => String(d.title))).toEqual(["north"]);
  });

  it("does not break a route that addresses rows by a ruled field", async () => {
    // The regression this guard shipped with, reproduced at the level it bit.
    // The rule DENIES NOBODY -- `read: () => true` -- and the guard keys on a
    // rule EXISTING rather than on its verdict, deliberately, because at query
    // time there is no row to judge it against. So merely declaring the rule
    // was enough to refuse every enforced lookup that addresses rows by that
    // field, which is how content routing finds a page by its slug.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "pages",
          access: { read: () => true, create: () => true, update: () => true },
          fields: [
            text({ name: "title" }),
            // Denies nobody, and still tripped the guard.
            text({ name: "note", access: { read: () => true } }),
          ],
        }),
      ],
    });
    const h = current.getService(
      "collectionsHandler"
    ) as unknown as ReadHandler;
    await h.createEntry(
      { collectionName: "pages", overrideAccess: true },
      { title: "about", note: "n" }
    );

    const addressed = await h.listEntries({
      collectionName: "pages",
      overrideAccess: false,
      where: { note: { equals: "n" } },
      frameworkFilter: true,
    });

    expect(addressed.success).toBe(true);
    expect(addressed.data!.docs.map(d => String(d.title))).toEqual(["about"]);
  });

  it("refuses the snake_case spelling of the denied sort field", async () => {
    // The ORDER BY path resolves a sort against the field NAME or its snake_case
    // COLUMN, so `secret_answer` and `secretAnswer` address the same hidden
    // column while looking like different strings. A guard keyed on the raw
    // spelling refuses one and waves the other through.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "vaultsb",
          access: { read: () => true, create: () => true, update: () => true },
          fields: [
            text({ name: "title" }),
            text({ name: "secretAnswer", access: { read: () => false } }),
          ],
        }),
      ],
    });
    const h = current.getService(
      "collectionsHandler"
    ) as unknown as ReadHandler;
    await h.createEntry(
      { collectionName: "vaultsb", overrideAccess: true },
      { title: "one", secretAnswer: "a" }
    );

    const refused = await h.listEntries({
      collectionName: "vaultsb",
      overrideAccess: false,
      sort: "secret_answer",
    });

    expect(refused.success).toBe(false);
    expect(JSON.stringify(refused)).toContain("FIELD_NOT_SORTABLE");
  });

  it("matches nothing when every searchable field is protected", async () => {
    // Narrowing the searchable set to empty must not drop the search CONDITION:
    // with no predicate the query returns every otherwise-visible row, which is
    // the opposite of a narrowed search and worse than the leak it closes.
    current = await createTestNextly({
      collections: [
        defineCollection({
          slug: "vaultsc",
          access: { read: () => true, create: () => true, update: () => true },
          // BOTH, because auto-detection carries `slug` as well as `title`.
          // Protecting only `title` leaves the row matchable through `slug` and
          // the empty case this test is about is never reached -- measured: the
          // first version of this test returned 1 row for exactly that reason.
          fields: [
            text({ name: "slug", access: { read: () => false } }),
            text({ name: "title", access: { read: () => false } }),
          ],
        }),
      ],
    });
    const h = current.getService(
      "collectionsHandler"
    ) as unknown as ReadHandler;
    await h.createEntry(
      { collectionName: "vaultsc", overrideAccess: true },
      { title: "one" }
    );

    const hit = await h.listEntries({
      collectionName: "vaultsc",
      overrideAccess: false,
      search: "one",
    });

    expect(hit.success).toBe(true);
    expect(hit.data!.docs).toHaveLength(0);
  });

  it("reports a real total when the framework addresses by a ruled field", async () => {
    // `listEntries` counts by re-entering `countEntries` with the SETTLED
    // predicate. Without carrying the decision, the count re-judged an input
    // the list had already allowed, and the rejection was swallowed into
    // `totalDocs = 0` -- a correct page with a total saying there was nothing.
    current = await boot();
    const h = current.getService(
      "collectionsHandler"
    ) as unknown as ReadHandler;

    const listed = await h.listEntries({
      collectionName: VAULTS,
      overrideAccess: false,
      where: { codename: { equals: "alpha" } },
      frameworkFilter: true,
    });

    expect(listed.success).toBe(true);
    expect(listed.data!.docs).toHaveLength(1);
    expect(
      (listed.data as unknown as { totalDocs?: number }).totalDocs,
      "the total must agree with the page it describes"
    ).toBe(1);
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
