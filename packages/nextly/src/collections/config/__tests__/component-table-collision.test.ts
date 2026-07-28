import { describe, expect, it } from "vitest";

import { NextlyError } from "../../../errors";
import { defineConfig } from "../define-config";

const field = { type: "text" as const, name: "title" };

function build(slugs: string[]) {
  return () =>
    defineConfig({
      collections: [],
      components: slugs.map(slug => ({
        slug,
        label: { singular: slug },
        fields: [field],
      })),
    } as never);
}

// Distinct slugs can derive one table because the resolver collapses separator
// runs; the config must say so rather than letting the unique index fail later.
describe("component slugs that derive the same table", () => {
  it("rejects slugs differing only by separators", () => {
    expect(build(["foo-bar", "foo--bar"])).toThrow(NextlyError);
  });

  it("names both slugs and the table in the failure detail", () => {
    try {
      build(["foo-bar", "foo--bar"])();
      expect.unreachable("expected a collision failure");
    } catch (error) {
      const detail = JSON.stringify(error);
      expect(detail).toContain("comp_foo_bar");
      expect(detail).toContain("foo--bar");
    }
  });

  it("accepts slugs that derive distinct tables", () => {
    expect(build(["foo-bar", "foo-baz"])).not.toThrow();
  });
});
