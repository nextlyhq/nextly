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
import {
  refreshCollectionSources,
  resetVerifiedTables,
  setDeferredCollections,
} from "../collection-sources";
import {
  clearSources,
  getSource,
  listSources,
  registerSource,
} from "../sources";

type Row = {
  slug: string;
  fields: Array<{ name: string; type: string; label?: string }>;
  timestamps?: boolean;
  status?: boolean;
  labels?: unknown;
  admin?: unknown;
  migrationStatus?: unknown;
  tableName?: string;
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

/**
 * Makes the registry answer with `rows` AND the database report `tables`.
 *
 * The plain `registryHolds` throws on `container.get("adapter")`, which is the
 * unanswerable-introspection path -- so a test that wants the STRUCTURAL
 * question asked has to supply a database that can answer it.
 */
function registryHoldsWithTables(
  rows: Row[],
  tables: string[]
): { listTables: ReturnType<typeof vi.fn> } {
  const listTables = vi.fn(async () => tables);
  containerGet.mockImplementation((name: string) => {
    if (name === "collectionRegistryService") {
      return { getAllCollections: async () => rows };
    }
    if (name === "adapter") return { listTables };
    throw new Error(`unexpected container.get("${name}") in this test`);
  });
  return { listTables };
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
  // The observed-table memo is pinned on `globalThis`, so without this a
  // verification from one test satisfies the next one's assertion.
  resetVerifiedTables();
  setDeferredCollections([]);
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

  it("carries a field's human label onto the source", async () => {
    // A table widget heads its columns with these. Without the label the admin
    // has only the storage name, so a column reads `publishedAt` -- and the
    // alternatives are worse: deriving prose from an identifier guesses at
    // capitalisation and word breaks, and asking the widget author to declare
    // headings puts a second answer beside `select`.
    registryHolds([
      {
        slug: "reports",
        fields: [{ name: "publishedAt", type: "date", label: "Published at" }],
      },
    ]);

    await refreshCollectionSources();

    const field = getSource("collection:reports")?.fields.find(
      f => f.name === "publishedAt"
    );
    expect(field?.label).toBe("Published at");
  });

  it("omits a label that is blank rather than heading a column with nothing", async () => {
    // `label` is optional on a field config, and a whitespace one is not a
    // heading. The admin falls back to the name, which is at least true.
    registryHolds([
      {
        slug: "reports",
        fields: [{ name: "slug", type: "text", label: "   " }],
      },
    ]);

    await refreshCollectionSources();

    const field = getSource("collection:reports")?.fields.find(
      f => f.name === "slug"
    );
    expect(field).toBeDefined();
    expect(field?.label).toBeUndefined();
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

  it("carries the collection's status setting into its source", async () => {
    // The same fact, one column over. `status: true` injects a `status` system
    // column, so a source that omits it refuses a query the read path would
    // have answered -- the timestamps defect running in the opposite
    // direction. The registry knows; it has to reach the source.
    registryHolds([
      { slug: "audit", fields: [] },
      { slug: "posts", fields: [], status: true },
    ]);

    await refreshCollectionSources();

    const audit = getSource("collection:audit")?.fields.map(f => f.name) ?? [];
    const posts = getSource("collection:posts")?.fields.map(f => f.name) ?? [];
    // The control: the same refresh DOES publish it for a collection that has
    // it, so the negative is not satisfied by never adding the column at all.
    expect(posts).toContain("status");
    expect(audit).not.toContain("status");
    // `status` defaults OFF, so the absent flag above is the ordinary case
    // rather than an explicit opt-out.
    expect(audit).toContain("id");
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

describe("the display label a source takes from the registry", () => {
  it("uses the collection's plural label", () => {
    registryHolds([
      {
        slug: "blog-posts",
        labels: { singular: "Article", plural: "Articles" },
        fields: [{ name: "title", type: "text" }],
        timestamps: true,
      },
    ]);
    return refreshCollectionSources().then(() => {
      expect(getSource("collection:blog-posts")?.label).toBe("Articles");
    });
  });

  it("does not let a WHITESPACE label take the whole install down", async () => {
    // 🔴 `validateSource` refuses a label that is empty after trimming, and
    // `defineCollection` preserves `labels.plural: "   "` as written. A check
    // for `!== ""` therefore accepted it, `registerSource` threw, and this
    // refresh runs on every workspace, layout and widget-query request -- so one
    // whitespace label failed all three for everybody.
    registryHolds([
      {
        slug: "posts",
        labels: { plural: "   " },
        fields: [{ name: "title", type: "text" }],
        timestamps: true,
      },
    ]);

    await expect(refreshCollectionSources()).resolves.toBeUndefined();
    expect(getSource("collection:posts")?.label).toBe("posts");
  });

  it("trims a label that is merely padded", async () => {
    // The control: without it the assertion above is satisfied by a reader that
    // ignores `labels` entirely and always answers with the slug.
    registryHolds([
      {
        slug: "posts",
        labels: { plural: "  Articles  " },
        fields: [{ name: "title", type: "text" }],
        timestamps: true,
      },
    ]);

    await refreshCollectionSources();
    expect(getSource("collection:posts")?.label).toBe("Articles");
  });
});

describe("a collection whose table is not there yet", () => {
  it("gets no source, so nothing offers a card that cannot be queried", async () => {
    // 🔴 A Schema-Builder collection is recorded `pending` and its migration
    // does not run outside development. The row exists, permission seeding
    // makes it visible, and the table arrives at the next deploy -- so a source
    // for it accepts queries that reach a table that is not there, once per
    // reader, until then.
    registryHolds([
      {
        slug: "drafts",
        migrationStatus: "pending",
        fields: [{ name: "title", type: "text" }],
        timestamps: true,
      },
    ]);

    await refreshCollectionSources();
    expect(getSource("collection:drafts")).toBeUndefined();
  });

  it("gives one to a PENDING collection whose table is actually there", async () => {
    // 🔴 The status is a LABEL and several writers maintain it badly. A Builder
    // collection deployed with `nextly migrate` keeps `pending` forever -- the
    // only writer that records `applied`, `registerFromMigrations`, runs from
    // the development boot path alone -- so its cards would never appear, on a
    // table that has been queryable since the deploy. Asked structurally, the
    // table is there and the source exists.
    registryHoldsWithTables(
      [
        {
          slug: "drafts",
          tableName: "dc_drafts",
          migrationStatus: "pending",
          fields: [{ name: "title", type: "text" }],
          timestamps: true,
        },
      ],
      ["dc_drafts"]
    );

    await refreshCollectionSources();
    expect(getSource("collection:drafts")).toBeDefined();
  });

  it("still refuses a PENDING collection whose table is genuinely absent", async () => {
    // The control the case above needs: without it, "trust the structure" is
    // satisfied by a filter that stopped refusing anything at all.
    registryHoldsWithTables(
      [
        {
          slug: "drafts",
          tableName: "dc_drafts",
          migrationStatus: "pending",
          fields: [{ name: "title", type: "text" }],
          timestamps: true,
        },
      ],
      ["dc_something_else"]
    );

    await refreshCollectionSources();
    expect(getSource("collection:drafts")).toBeUndefined();
  });

  it("withholds a DEFERRED collection even though its old table exists", async () => {
    // 🔴 The case table existence cannot see. A reload writes the new field list
    // for EVERY configured collection -- the sync payload is the whole config --
    // while refusing the DDL for one it classified unsafe. That collection keeps
    // its OLD table, which exists, beside a NEW field list the table never
    // received. Verified structurally it would publish a source naming columns
    // the database does not have, and the query fails after validating.
    setDeferredCollections(["drafts"]);
    registryHoldsWithTables(
      [
        {
          slug: "drafts",
          tableName: "dc_drafts",
          migrationStatus: "pending",
          fields: [{ name: "title", type: "text" }],
          timestamps: true,
        },
      ],
      ["dc_drafts"]
    );

    await refreshCollectionSources();
    expect(getSource("collection:drafts")).toBeUndefined();
  });

  it("withholds a DEFERRED collection whose label still claims presence", async () => {
    // The nastier half: the refusal has to override the LABEL too, not only the
    // observed table. A collection edited after a healthy apply still carries
    // `applied` from the previous cycle while its new fields sit unapplied, so a
    // guard that only overrode the structural answer would publish it.
    setDeferredCollections(["posts"]);
    registryHoldsWithTables(
      [
        {
          slug: "posts",
          tableName: "dc_posts",
          migrationStatus: "applied",
          fields: [{ name: "title", type: "text" }],
          timestamps: true,
        },
      ],
      ["dc_posts"]
    );

    await refreshCollectionSources();
    expect(getSource("collection:posts")).toBeUndefined();
  });

  it("publishes a collection again once the reload stops deferring it", async () => {
    // The control: without it the two refusals above are satisfied by a guard
    // that withholds permanently. A later successful reload REPLACES the set,
    // so the refusal lifts with nobody having to clear it.
    setDeferredCollections(["drafts"]);
    registryHoldsWithTables(
      [
        {
          slug: "drafts",
          tableName: "dc_drafts",
          migrationStatus: "pending",
          fields: [{ name: "title", type: "text" }],
          timestamps: true,
        },
      ],
      ["dc_drafts"]
    );
    await refreshCollectionSources();
    expect(getSource("collection:drafts")).toBeUndefined();

    setDeferredCollections([]);
    await refreshCollectionSources();
    expect(getSource("collection:drafts")).toBeDefined();
  });

  it("asks the database NOTHING for a deferred collection", async () => {
    // A deferred collection is excluded whatever the database answers, so a
    // lookup for it is a round trip whose result is discarded -- on every
    // request, for as long as the refusal stands.
    setDeferredCollections(["drafts"]);
    const { listTables } = registryHoldsWithTables(
      [
        {
          slug: "drafts",
          tableName: "dc_drafts",
          migrationStatus: "pending",
          fields: [{ name: "title", type: "text" }],
          timestamps: true,
        },
      ],
      ["dc_drafts"]
    );

    await refreshCollectionSources();
    expect(listTables).not.toHaveBeenCalled();
  });

  it("asks the database NOTHING when every label already claims presence", async () => {
    // The cost property, asserted rather than assumed. `refreshCollectionSources`
    // runs on every workspace, layout and widget request, so introspecting per
    // request would be a database round trip on the hot path. The label settles
    // the common case and the structural question is asked only of the
    // collections it declines -- which is the population it is wrong about.
    const { listTables } = registryHoldsWithTables(
      [
        {
          slug: "posts",
          tableName: "dc_posts",
          migrationStatus: "applied",
          fields: [{ name: "title", type: "text" }],
          timestamps: true,
        },
        {
          slug: "pages",
          tableName: "dc_pages",
          migrationStatus: "synced",
          fields: [{ name: "title", type: "text" }],
          timestamps: true,
        },
      ],
      ["dc_posts", "dc_pages"]
    );

    await refreshCollectionSources();
    expect(getSource("collection:posts")).toBeDefined();
    expect(listTables).not.toHaveBeenCalled();
  });

  it("does not re-introspect for a table it has already observed", async () => {
    // A table that exists does not stop existing, so one observation settles it
    // for the life of the process. Without this, a collection stuck on a wrong
    // label would introspect on every request forever -- which is precisely the
    // state this change exists to serve.
    const { listTables } = registryHoldsWithTables(
      [
        {
          slug: "drafts",
          tableName: "dc_drafts",
          migrationStatus: "pending",
          fields: [{ name: "title", type: "text" }],
          timestamps: true,
        },
      ],
      ["dc_drafts"]
    );

    await refreshCollectionSources();
    expect(listTables).toHaveBeenCalledTimes(1);

    await refreshCollectionSources();
    expect(getSource("collection:drafts")).toBeDefined();
    expect(listTables).toHaveBeenCalledTimes(1);
  });

  it("DOES give one to a collection whose migration ran", async () => {
    // The control: without it the refusal above is satisfied by a filter that
    // drops every collection.
    registryHolds([
      {
        slug: "posts",
        migrationStatus: "applied",
        fields: [{ name: "title", type: "text" }],
        timestamps: true,
      },
    ]);

    await refreshCollectionSources();
    expect(getSource("collection:posts")).toBeDefined();
  });

  it("DOES give one to a code-first collection", async () => {
    // `synced` is what a code-first collection carries: migrations own its
    // table, so it is present.
    registryHolds([
      {
        slug: "pages",
        migrationStatus: "synced",
        fields: [{ name: "title", type: "text" }],
        timestamps: true,
      },
    ]);

    await refreshCollectionSources();
    expect(getSource("collection:pages")).toBeDefined();
  });

  it("DOES give one to a row that predates the status field", async () => {
    // 🔴 The one place this reads generously rather than closed. The field was
    // added after rows existed, so a row without it says nothing about its
    // table -- and those tables do exist. Refusing them would take widgets away
    // from every collection an older install already had, to guard against a
    // state they are not in.
    registryHolds([
      {
        slug: "legacy",
        fields: [{ name: "title", type: "text" }],
        timestamps: true,
      },
    ]);

    await refreshCollectionSources();
    expect(getSource("collection:legacy")).toBeDefined();
  });
});
