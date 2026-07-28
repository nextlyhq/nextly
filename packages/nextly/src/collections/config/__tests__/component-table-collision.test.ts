import { describe, expect, it } from "vitest";

import { defineConfig } from "../define-config";

const field = { type: "text" as const, name: "title" };

// Distinct slugs can derive one table because the resolver collapses separator
// runs; the config must say so rather than letting the unique index fail later.
describe("component slugs that derive the same table", () => {
  it("rejects slugs differing only by separators", () => {
    expect(() =>
      defineConfig({
        collections: [],
        components: [
          { slug: "foo-bar", label: { singular: "A" }, fields: [field] },
          { slug: "foo--bar", label: { singular: "B" }, fields: [field] },
        ],
      } as never)
    ).toThrow(/both resolve to the table/);
  });

  it("accepts slugs that derive distinct tables", () => {
    expect(() =>
      defineConfig({
        collections: [],
        components: [
          { slug: "foo-bar", label: { singular: "A" }, fields: [field] },
          { slug: "foo-baz", label: { singular: "B" }, fields: [field] },
        ],
      } as never)
    ).not.toThrow();
  });
});
