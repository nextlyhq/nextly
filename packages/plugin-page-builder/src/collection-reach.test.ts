/**
 * What the page builder knows of a collection from the site's code alone:
 * whether its entries may be served at an address, and whether its documents
 * may hold blocks. A collection the code does not declare is not answered,
 * and so may be either.
 */
import { describe, expect, it } from "vitest";

import { collectionReach } from "./collection-reach";

const text = (name: string) => ({ name, type: "text" });

/** The site's code: each collection as `ctx.config` lists it. */
const COLLECTIONS = [
  // Another plugin's private records, with the slug core gives every one.
  { slug: "records", internal: true, fields: [text("slug"), text("note")] },
  // Kept out of the admin without being internal.
  { slug: "hidden", admin: { hidden: true }, fields: [text("slug")] },
  { slug: "notes", fields: [text("slug"), text("title")] },
  // No slug to serve an entry at.
  { slug: "tags", fields: [text("title")] },
  { slug: "translated", localized: true, fields: [text("slug")] },
  { slug: "posts", fields: [text("title")] },
  {
    slug: "articles",
    internal: true,
    fields: [{ name: "body", type: "blocks" }],
  },
  {
    slug: "sections",
    internal: true,
    fields: [
      {
        name: "rows",
        type: "repeater",
        fields: [{ name: "b", type: "blocks" }],
      },
    ],
  },
  {
    slug: "with-site-group",
    internal: true,
    fields: [{ name: "hero", type: "component", component: "hero" }],
  },
  {
    slug: "with-plain-group",
    internal: true,
    fields: [{ name: "meta", type: "component", component: "meta" }],
  },
  {
    slug: "pages",
    fields: [text("slug"), { name: "content", type: "blocks" }],
  },
];

/** Field groups the code declares: one holding a blocks field, one not. */
const GROUPS: Record<string, { fields: unknown[] }> = {
  hero: { fields: [{ name: "body", type: "blocks" }] },
  meta: { fields: [text("summary")] },
};

const reach = collectionReach({
  collections: () => COLLECTIONS,
  fieldGroups: slug => GROUPS[slug],
  // `posts` is given an address in code, though it has no slug field here.
  addresses: new Set(["posts"]),
  own: () => new Set(["pages"]),
});

describe("collectionReach", () => {
  it("serves entries where a template may serve them or code gives an address", () => {
    expect(reach.mayServeEntries("notes")).toBe(true);
    expect(reach.mayServeEntries("posts")).toBe(true);
  });

  it("serves none of a private, hidden, slugless or localized collection, nor the page builder's own", () => {
    for (const slug of ["records", "hidden", "tags", "translated", "pages"]) {
      expect(reach.mayServeEntries(slug), slug).toBe(false);
    }
  });

  it("holds blocks where the declaration has a blocks field anywhere, or a field group it cannot see into", () => {
    for (const slug of ["articles", "sections", "with-site-group", "pages"]) {
      expect(reach.mayHoldBlocks(slug), slug).toBe(true);
    }
  });

  it("holds none where neither the declaration nor a field group it places has a blocks field", () => {
    for (const slug of ["records", "notes", "tags", "with-plain-group"]) {
      expect(reach.mayHoldBlocks(slug), slug).toBe(false);
    }
  });

  it("answers both for a collection the code does not declare, which the Schema Builder may change", () => {
    expect(reach.mayServeEntries("made-at-runtime")).toBe(true);
    expect(reach.mayHoldBlocks("made-at-runtime")).toBe(true);
  });

  it("follows a field group the code does not declare, which the admin may change", () => {
    const unresolved = collectionReach({
      collections: () => COLLECTIONS,
      fieldGroups: () => undefined,
      addresses: new Set(),
      own: () => new Set(),
    });
    expect(unresolved.mayHoldBlocks("with-plain-group")).toBe(true);
  });

  it("reads the declarations again once they are another list", () => {
    let list: unknown[] = [{ slug: "later", fields: [text("title")] }];
    const changing = collectionReach({
      collections: () => list,
      fieldGroups: () => undefined,
      addresses: new Set(),
      own: () => new Set(),
    });
    expect(changing.mayHoldBlocks("later")).toBe(false);
    list = [{ slug: "later", fields: [{ name: "body", type: "blocks" }] }];
    expect(changing.mayHoldBlocks("later")).toBe(true);
  });
});
