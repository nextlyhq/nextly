import { describe, expect, it } from "vitest";

import type { DesiredCollection, DesiredSingle } from "../types";

import { buildDesiredSchemaFromRegistry } from "../snapshot";

// Stub registry — only needs the getAllCollectionsRecords /
// getAllSinglesRecords / getAllComponentsRecords methods that the helper
// reads. Helper is decoupled from the full SchemaRegistry surface so it
// can be unit-tested with plain in-memory stubs.
function makeStubRegistry(args: {
  collections?: Array<{ slug: string; tableName: string; fields: unknown[] }>;
  singles?: Array<{ slug: string; tableName: string; fields: unknown[] }>;
  components?: Array<{ slug: string; tableName: string; fields: unknown[] }>;
}) {
  return {
    getAllCollectionsRecords: () => args.collections ?? [],
    getAllSinglesRecords: () => args.singles ?? [],
    getAllComponentsRecords: () => args.components ?? [],
  };
}

describe("buildDesiredSchemaFromRegistry", () => {
  it("projects flat registry records into three buckets keyed by slug", () => {
    const registry = makeStubRegistry({
      collections: [
        { slug: "posts", tableName: "dc_posts", fields: [] },
        { slug: "pages", tableName: "dc_pages", fields: [] },
      ],
      singles: [{ slug: "homepage", tableName: "single_homepage", fields: [] }],
      components: [{ slug: "button", tableName: "comp_button", fields: [] }],
    });

    const desired = buildDesiredSchemaFromRegistry(registry);

    expect(Object.keys(desired.collections)).toEqual(["posts", "pages"]);
    expect(desired.collections.posts).toMatchObject({
      slug: "posts",
      tableName: "dc_posts",
    });
    expect(Object.keys(desired.singles)).toEqual(["homepage"]);
    expect(Object.keys(desired.components)).toEqual(["button"]);
  });

  it("applies collection overrides on top of the registry snapshot", () => {
    const registry = makeStubRegistry({
      collections: [{ slug: "posts", tableName: "dc_posts", fields: [] }],
    });
    const newPosts: DesiredCollection = {
      slug: "posts",
      tableName: "dc_posts",
      fields: [{ name: "title", type: "text" }],
    };

    const desired = buildDesiredSchemaFromRegistry(registry, {
      collections: { posts: newPosts },
    });

    expect(desired.collections.posts.fields).toHaveLength(1);
    expect(desired.collections.posts.fields[0]).toMatchObject({
      name: "title",
      type: "text",
    });
  });

  it("returns empty buckets when registry is empty and no overrides given", () => {
    const registry = makeStubRegistry({});

    const desired = buildDesiredSchemaFromRegistry(registry);

    expect(desired.collections).toEqual({});
    expect(desired.singles).toEqual({});
    expect(desired.components).toEqual({});
  });

  it("applies single overrides without touching collections", () => {
    const registry = makeStubRegistry({
      collections: [{ slug: "posts", tableName: "dc_posts", fields: [] }],
      singles: [{ slug: "homepage", tableName: "single_homepage", fields: [] }],
    });
    const newHomepage: DesiredSingle = {
      slug: "homepage",
      tableName: "single_homepage",
      fields: [{ name: "heroTitle", type: "text" }],
    };

    const desired = buildDesiredSchemaFromRegistry(registry, {
      singles: { homepage: newHomepage },
    });

    expect(desired.collections.posts).toBeDefined();
    expect(desired.singles.homepage.fields).toHaveLength(1);
  });
});
