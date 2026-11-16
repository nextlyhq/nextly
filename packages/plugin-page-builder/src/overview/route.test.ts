/**
 * The overview's read, as one caller may see it: the libraries they may read,
 * under the slugs the site registered, each with its count and whether they
 * may create in it; and the collections and Singles that have a Page Builder
 * field, derived from the registries, as far as they may read them.
 */
import { describe, expect, it, vi } from "vitest";

import type { OverviewContext, OverviewReads } from "./route";
// The server's own reads, for the one test that runs them: core's count and
// a Single's read, made as the caller.
const { count, findSingle } = vi.hoisted(() => ({
  count: vi.fn(),
  findSingle: vi.fn(),
}));
vi.mock("nextly/runtime", async importOriginal => ({
  ...(await importOriginal<typeof import("nextly/runtime")>()),
  requireNextly: () => ({ count, findSingle }),
}));

import { pageBuilderUses, readOverview } from "./route";

const blocks = (name: string, label?: string) => ({
  name,
  type: "blocks",
  ...(label === undefined ? {} : { label }),
});

const collection = (
  slug: string,
  fields: unknown[],
  extra: Record<string, unknown> = {}
) => ({
  slug,
  label: slug,
  labels: { plural: `${slug[0]?.toUpperCase()}${slug.slice(1)}` },
  fields,
  ...extra,
});

/** The registries a site of every case holds. */
const COLLECTIONS = [
  collection("pages", [
    { name: "title", type: "text" },
    blocks("layout", "Layout"),
  ]),
  collection("posts", [{ name: "title", type: "text" }]),
  collection("landing", [
    { name: "hero", type: "group", fields: [blocks("body")] },
  ]),
  // A library: what pages are built from, not where the builder is used.
  collection("patterns", [blocks("content")], { admin: { hidden: true } }),
  collection("site-patterns", [blocks("content")]),
  // Hidden from the admin, so nothing to open.
  collection("drafts", [blocks("content")], { admin: { hidden: true } }),
  // Its table is not there yet.
  collection("pending", [blocks("content")], { migrationStatus: "pending" }),
  // The host's own component store.
  collection("site-components", [blocks("definition")]),
];

const SINGLES = [
  {
    slug: "homepage",
    label: "Homepage",
    source: "code",
    fields: [blocks("layout", "Layout")],
  },
  {
    slug: "footer",
    label: "Footer",
    source: "code",
    fields: [{ name: "note", type: "text" }],
  },
  // Removed from config, its row left behind.
  {
    slug: "old-home",
    label: "Old home",
    source: "code",
    fields: [blocks("layout")],
  },
  {
    slug: "about",
    label: "About",
    source: "builder",
    fields: [blocks("content", "Content")],
  },
];

function contextFor(
  can: (action: string, resource: string) => boolean,
  renames: Record<string, string> = {}
): OverviewContext {
  return {
    caller: {
      can: async (action, resource) => can(action, resource),
      // Read only by the reads these tests answer themselves.
      identity: async () => {
        throw new Error("the caller's identity is not read here");
      },
    },
    self: { collections: renames },
    services: {
      collections: {
        listCollections: async () => ({
          data: COLLECTIONS,
          pagination: { hasMore: false },
        }),
      },
      singles: {
        list: async ({ offset }) => ({
          data: offset === 0 ? SINGLES : [],
          total: SINGLES.length,
        }),
      },
    },
    config: {
      singles: [{ slug: "homepage" }, { slug: "footer" }],
    },
  };
}

/** Counts by collection, and the Singles the caller's read answers for. */
function readsOf(
  counts: Record<string, number>,
  readableSingles: string[]
): OverviewReads {
  return {
    count: async (_ctx, slug) => counts[slug] ?? null,
    singleReadable: async (_ctx, slug) => readableSingles.includes(slug),
  };
}

const COUNTS = {
  patterns: 12,
  "site-patterns": 12,
  components: 8,
  layouts: 3,
  templates: 5,
  pages: 27,
  landing: 6,
};

describe("the overview's libraries", () => {
  it("lists those the caller may read, counted, with New where they may create", async () => {
    const answer = await readOverview(
      contextFor(
        (action, resource) =>
          resource !== "layouts" &&
          (action === "read" || resource === "patterns")
      ),
      {},
      readsOf(COUNTS, [])
    );
    expect(answer.libraries).toEqual([
      { kind: "patterns", collection: "patterns", count: 12, mayCreate: true },
      {
        kind: "components",
        collection: "components",
        count: 8,
        mayCreate: false,
      },
      {
        kind: "templates",
        collection: "templates",
        count: 5,
        mayCreate: false,
      },
    ]);
  });

  it("names a renamed library by the slug the site registered", async () => {
    const asked: string[] = [];
    const answer = await readOverview(
      contextFor(
        (action, resource) => {
          asked.push(`${action}-${resource}`);
          return true;
        },
        { patterns: "site-patterns" }
      ),
      {},
      readsOf(COUNTS, [])
    );
    expect(answer.libraries[0]).toEqual({
      kind: "patterns",
      collection: "site-patterns",
      count: 12,
      mayCreate: true,
    });
    expect(asked).toContain("create-site-patterns");
    expect(asked).not.toContain("read-patterns");
  });

  it("draws a library whose count cannot be read without one", async () => {
    const answer = await readOverview(
      contextFor(() => true),
      {},
      readsOf({}, [])
    );
    expect(answer.libraries.map(library => library.count)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("where the overview says the builder is used", () => {
  it("lists the collections, then the Singles, the caller may read", async () => {
    const answer = await readOverview(
      contextFor((_action, resource) => resource !== "landing"),
      { collection: "site-components" },
      readsOf(COUNTS, ["homepage"])
    );
    expect(answer.usedIn).toEqual([
      {
        kind: "collection",
        slug: "pages",
        label: "Pages",
        field: "Layout",
        entries: 27,
      },
      // Not one of this site's libraries, which are not renamed here.
      {
        kind: "collection",
        slug: "site-patterns",
        label: "Site-patterns",
        field: "content",
        entries: 12,
      },
      { kind: "single", slug: "homepage", label: "Homepage", field: "Layout" },
    ]);
  });

  it("lists every use a caller who may read everything can open", async () => {
    const answer = await readOverview(
      contextFor(() => true),
      { collection: "site-components" },
      // The Single removed from config would answer a read; it is left
      // out as one the site no longer declares.
      readsOf(COUNTS, ["homepage", "about", "old-home"])
    );
    expect(answer.usedIn.map(use => `${use.kind}:${use.slug}`)).toEqual([
      // By name: Landing, Pages.
      "collection:landing",
      "collection:pages",
      "collection:site-patterns",
      // By name: About, Homepage.
      "single:about",
      "single:homepage",
    ]);
    // A field inside a group is named by its path where it has no label.
    expect(answer.usedIn[0]?.field).toBe("hero.body");
  });

  it("answers nothing for a caller nobody identified", async () => {
    const ctx = { ...contextFor(() => true), caller: null };
    expect(await readOverview(ctx, {}, readsOf(COUNTS, ["homepage"]))).toEqual({
      libraries: [],
      usedIn: [],
    });
  });
});

describe("pageBuilderUses", () => {
  it("is empty where nothing has a Page Builder field", () => {
    expect(
      pageBuilderUses(
        [collection("posts", [{ name: "title", type: "text" }])],
        [{ slug: "footer", fields: [] }],
        new Set()
      )
    ).toEqual([]);
  });

  it("leaves out the libraries and the host's store it is told to", () => {
    const uses = pageBuilderUses(
      COLLECTIONS,
      [],
      new Set(["site-patterns", "site-components"])
    );
    expect(uses.map(use => use.slug)).toEqual(["landing", "pages"]);
    // The control: without the exclusions, both are listed.
    expect(
      pageBuilderUses(COLLECTIONS, [], new Set()).map(use => use.slug)
    ).toEqual(["landing", "pages", "site-components", "site-patterns"]);
  });
});

describe("the overview's own reads", () => {
  it("count every entry the caller may open, drafts included", async () => {
    count.mockResolvedValue({ total: 4 });
    findSingle.mockResolvedValue({ id: "single" });
    const ctx = contextFor(() => true);
    // The real reads ask who the caller is, which the other tests never reach.
    const caller = ctx.caller as NonNullable<OverviewContext["caller"]>;
    const answer = await readOverview(
      {
        ...ctx,
        caller: { ...caller, identity: async () => ({ user: { id: "u1" } }) },
      } as OverviewContext,
      { collection: undefined }
    );
    expect(count).toHaveBeenCalled();
    for (const [args] of count.mock.calls) {
      expect(args).toMatchObject({ status: "all", overrideAccess: false });
    }
    expect(answer.libraries.map(library => library.count)).toEqual([
      4, 4, 4, 4,
    ]);
  });
});
