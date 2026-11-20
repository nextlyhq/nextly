import { describe, expect, it } from "vitest";

import { crossEntityProblems } from "../cross-entity-problems";
import { defineConfig } from "../define-config";

const field = { type: "text" as const, name: "title" };

function groups(slugs: string[]) {
  return slugs.map(slug => ({
    slug,
    label: { singular: slug },
    fields: [field],
  }));
}

function build(slugs: string[]) {
  return () =>
    defineConfig({ collections: [], fieldGroups: groups(slugs) } as never);
}

// Distinct slugs can derive one table because the resolver collapses separator
// runs; the config must say so rather than letting the unique index fail later.
// Reported where the configuration is loaded or started, with every other problem in it.
describe("component slugs that derive the same table", () => {
  it("are refused, at the second slug", () => {
    expect(
      crossEntityProblems({ fieldGroups: groups(["foo-bar", "foo--bar"]) })
    ).toEqual([
      expect.objectContaining({
        path: "fieldGroups[1].slug",
        code: "COMPONENT_TABLE_COLLISION",
      }),
    ]);
    // Not thrown at import any more: the configuration's check reports it with the rest.
    expect(build(["foo-bar", "foo--bar"])).not.toThrow();
  });

  it("names both slugs and the table", () => {
    const [problem] = crossEntityProblems({
      fieldGroups: groups(["foo-bar", "foo--bar"]),
    });
    expect(problem?.message).toContain("comp_foo_bar");
    expect(problem?.message).toContain("foo-bar");
    expect(problem?.message).toContain("foo--bar");
  });

  it("accepts slugs that derive distinct tables", () => {
    expect(
      crossEntityProblems({ fieldGroups: groups(["foo-bar", "foo-baz"]) })
    ).toEqual([]);
  });
});
