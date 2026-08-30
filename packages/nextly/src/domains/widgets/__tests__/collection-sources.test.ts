/**
 * Collection sources come from the collection registry, which is the only
 * description of an install's collections that holds BOTH schema modes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// The registry is reached through the DI container, so the container module is
// the seam -- the same one `services/dashboard/__tests__/dashboard-scope.test.ts`
// uses for `DashboardService`.
vi.mock("../../../di/container", () => ({ container: { get: vi.fn() } }));

import { container } from "../../../di/container";
import { setNextlyLogger } from "../../../observability/logger";
import { refreshCollectionSources } from "../collection-sources";
import {
  clearSources,
  getSource,
  listSources,
  registerSource,
} from "../sources";

type Row = {
  slug: string;
  fields: Array<{ name: string; type: string }>;
  timestamps?: boolean;
};

const containerGet = container.get as ReturnType<typeof vi.fn>;

/** Makes the registry answer with `rows`. */
function registryHolds(rows: Row[]): void {
  containerGet.mockImplementation((name: string) => {
    if (name === "collectionRegistryService") {
      return { getAllCollections: async () => rows };
    }
    throw new Error(`unexpected container.get("${name}") in this test`);
  });
}

/** Makes the registry unreachable, the way a failed read or a cold container is. */
function registryUnreachable(): void {
  containerGet.mockImplementation(() => {
    throw new Error("Service is not registered in container");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearSources();
  setNextlyLogger({
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
  });
});

describe("refreshCollectionSources", () => {
  it("publishes a source for a collection that exists ONLY in the registry", async () => {
    // A Schema-Builder collection lives in `dynamic_collections` and has no
    // entry in the code config at all, so a source registry derived from the
    // config answered "unavailable source" for every one of them -- while the
    // Direct API read it and the dashboard listed it, both from this registry.
    registryHolds([
      { slug: "reports", fields: [{ name: "title", type: "text" }] },
    ]);

    await refreshCollectionSources();

    const source = getSource("collection:reports");
    expect(source?.kind).toBe("collection");
    expect(source?.fields.map(f => f.name)).toContain("title");
  });

  it("drops the source for a collection that has left the registry", async () => {
    // The direction that is easy to omit. A source declares what a query may
    // NAME, so a set that only ever grows keeps naming a collection that is
    // gone.
    registryHolds([{ slug: "reports", fields: [] }]);
    await refreshCollectionSources();
    expect(getSource("collection:reports")).toBeDefined();

    registryHolds([{ slug: "posts", fields: [] }]);
    await refreshCollectionSources();

    expect(getSource("collection:reports")).toBeUndefined();
    expect(getSource("collection:posts")).toBeDefined();
  });

  it("republishes the same collections without colliding with itself", async () => {
    // Every request refreshes, so the second pass runs against a store that
    // already holds the first pass's answer. `registerSource` refuses a
    // duplicate id, correctly, which is why the rebuild replaces by kind.
    registryHolds([{ slug: "posts", fields: [] }]);
    await refreshCollectionSources();
    await expect(refreshCollectionSources()).resolves.toBeUndefined();
    expect(listSources()).toHaveLength(1);
  });

  it("leaves a plugin's own sources alone", async () => {
    // A `plugin:` source is declared once at boot and says nothing about which
    // collections exist, so a collection rebuild must not sweep it away.
    registerSource({
      id: "plugin:stripe/revenue",
      label: "Revenue",
      kind: "plugin",
      supports: ["count"],
      fields: [{ name: "total", type: "number" }],
    });
    registryHolds([{ slug: "posts", fields: [] }]);

    await refreshCollectionSources();

    expect(getSource("plugin:stripe/revenue")).toBeDefined();
    expect(getSource("collection:posts")).toBeDefined();
  });

  it("keeps the last good sources when the registry cannot be reached", async () => {
    // "This install has no collections" and "I could not ask" are different
    // answers. Publishing the first for the second blanks every widget on the
    // dashboard over one transient database failure -- and it would not buy
    // any safety, because a source only says what a query may NAME: execution
    // still runs `overrideAccess: false` with the requesting caller.
    registryHolds([{ slug: "posts", fields: [] }]);
    await refreshCollectionSources();

    registryUnreachable();
    await refreshCollectionSources();

    expect(getSource("collection:posts")).toBeDefined();
  });

  it("publishes an empty set when the registry genuinely holds none", async () => {
    // The control for the case above: an empty ANSWER is an answer, and it
    // must clear -- otherwise the two outcomes are indistinguishable and the
    // test above would pass on a function that never publishes anything.
    registryHolds([{ slug: "posts", fields: [] }]);
    await refreshCollectionSources();

    registryHolds([]);
    await refreshCollectionSources();

    expect(getSource("collection:posts")).toBeUndefined();
  });

  it("carries the collection's timestamps setting into its source", async () => {
    // `timestamps: false` means the table has no `created_at`/`updated_at`
    // columns, so a source declaring them selectable and sortable produces a
    // query that validates and then fails in the read path on a missing
    // column. The registry knows the answer; it has to reach the source.
    registryHolds([
      { slug: "audit", fields: [], timestamps: false },
      { slug: "posts", fields: [], timestamps: true },
    ]);

    await refreshCollectionSources();

    const audit = getSource("collection:audit")?.fields.map(f => f.name) ?? [];
    const posts = getSource("collection:posts")?.fields.map(f => f.name) ?? [];
    expect(audit).not.toContain("createdAt");
    expect(audit).toContain("id");
    // The control: the same refresh DOES publish them for a collection that
    // has them, so the assertion above is not satisfied by never adding any.
    expect(posts).toContain("createdAt");
    expect(posts).toContain("updatedAt");
  });

  it("skips a field that carries no name of its own", async () => {
    // A `group` field is a layout container over named children and has no
    // `name`. Admitting it would declare a source field no query could ever
    // reference.
    registryHolds([
      {
        slug: "posts",
        fields: [
          { name: "title", type: "text" },
          { type: "group" },
        ] as Row["fields"],
      },
    ]);

    await refreshCollectionSources();

    expect(getSource("collection:posts")?.fields.map(f => f.name)).toEqual(
      expect.arrayContaining(["title"])
    );
    expect(
      getSource("collection:posts")?.fields.some(f => f.name === undefined)
    ).toBe(false);
  });
});

describe("fields inside a presentational group are addressable", () => {
  // A group with NO name is layout: its children are stored and queried at the
  // level the group sits in. Dropping the container without traversing it
  // therefore made every field inside one unreachable -- the source refused a
  // valid `select`, `sort` or `where` naming a column the collection has.
  it("declares a field inside an unnamed group", async () => {
    registryHolds([
      {
        slug: "posts",
        fields: [
          { name: "title", type: "text" },
          {
            type: "group",
            fields: [{ name: "seoTitle", type: "text" }],
          },
        ] as unknown as Row["fields"],
      },
    ]);

    await refreshCollectionSources();

    expect(getSource("collection:posts")?.fields.map(f => f.name)).toContain(
      "seoTitle"
    );
  });

  it("flattens a group nested inside another unnamed group", async () => {
    registryHolds([
      {
        slug: "posts",
        fields: [
          {
            type: "group",
            fields: [
              { type: "group", fields: [{ name: "ogImage", type: "text" }] },
            ],
          },
        ] as unknown as Row["fields"],
      },
    ]);

    await refreshCollectionSources();

    expect(getSource("collection:posts")?.fields.map(f => f.name)).toContain(
      "ogImage"
    );
  });

  it("declares a NAMED group under its own name, not its children", async () => {
    // What the shared walker says, rather than what a widget source might
    // prefer: a named group stores its children UNDER itself, so the group is
    // the addressable thing at this level and `seoTitle` is not.
    registryHolds([
      {
        slug: "posts",
        fields: [
          {
            name: "meta",
            type: "group",
            fields: [{ name: "seoTitle", type: "text" }],
          },
        ] as unknown as Row["fields"],
      },
    ]);

    await refreshCollectionSources();

    const names = getSource("collection:posts")?.fields.map(f => f.name);
    expect(names).toContain("meta");
    expect(names).not.toContain("seoTitle");
  });

  it("does NOT declare a field inside an unnamed REPEATER", async () => {
    // The distinction the shared walker exists to make. A repeater's children
    // are stored PER ROW, not at this level, so declaring one would be a
    // promise the read path cannot keep -- the query passes validation and
    // fails on a missing column, which is the same failure `timestamps: false`
    // produces and which the source list is built to avoid.
    registryHolds([
      {
        slug: "posts",
        fields: [
          { name: "title", type: "text" },
          {
            type: "repeater",
            fields: [{ name: "lineItem", type: "text" }],
          },
        ] as unknown as Row["fields"],
      },
    ]);

    await refreshCollectionSources();

    const names = getSource("collection:posts")?.fields.map(f => f.name);
    expect(names).toContain("title");
    expect(names).not.toContain("lineItem");
  });

  it("still withholds a password nested inside an unnamed group", async () => {
    // Traversal must not become a way around the never-exposed types: the
    // filter runs on what the walk emits, not on the top level only.
    registryHolds([
      {
        slug: "users",
        fields: [
          {
            type: "group",
            fields: [{ name: "secret", type: "password" }],
          },
        ] as unknown as Row["fields"],
      },
    ]);

    await refreshCollectionSources();

    expect(
      getSource("collection:users")?.fields.map(f => f.name)
    ).not.toContain("secret");
  });
});
