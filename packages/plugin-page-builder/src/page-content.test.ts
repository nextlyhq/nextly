/**
 * The content route's provider: the addresses it pre-renders are those under
 * the route's mount, counted toward the limit only once filtered, so paths
 * elsewhere in the store never crowd out the ones the route serves.
 */
import { describe, expect, it } from "vitest";

import { CONTENT_ADDRESS_SERVICE } from "./address-claims/content-addresses";
import { PAGE_BUILDER_PLUGIN_NAME } from "./library-contract";
import { pageBuilderContent } from "./page-content";

/** A store of 500 addresses elsewhere, then two under `/site`. */
function instance() {
  const elsewhere = Array.from({ length: 500 }, (_, at) => ["blog", `p${at}`]);
  const all = [...elsewhere, ["site", "about"], ["site", "news"]];
  return {
    plugins: {
      [PAGE_BUILDER_PLUGIN_NAME]: {
        [CONTENT_ADDRESS_SERVICE]: {
          holderAt: async () => null,
          addresses: async (
            _locale: string | undefined,
            { limit, page = 1 }: { limit: number; page?: number }
          ) => ({
            paths: all.slice((page - 1) * limit, page * limit),
            total: all.length,
          }),
        },
      },
    },
    find: async () => ({ items: [] }),
  };
}

describe("the addresses a mounted route pre-renders", () => {
  it("are the ones under its mount, however many lie elsewhere", async () => {
    const content = pageBuilderContent({ nextly: instance() });
    expect(await content.addresses(undefined, 2, ["site"])).toEqual([
      ["site", "about"],
      ["site", "news"],
    ]);
  });

  it("stop at the limit", async () => {
    const content = pageBuilderContent({ nextly: instance() });
    expect(await content.addresses(undefined, 1, ["site"])).toEqual([
      ["site", "about"],
    ]);
    expect(await content.addresses(undefined, 3, [])).toHaveLength(3);
  });
});

/** A design document, told apart by its one node's id. */
const design = (id: string) => ({
  formatVersion: 1,
  kind: "template",
  nodes: [{ id, type: "core/heading", version: 1, props: {} }],
});

/** The collection's published template, and own designs in each state. */
const TEMPLATE_ROW = {
  id: "t1",
  collection: "posts",
  entry: null,
  status: "published",
  content: design("template"),
};
const OWN_ROW = {
  id: "own-1",
  collection: null,
  entry: "posts/p%201",
  status: "published",
  content: design("own"),
};

/**
 * Whether `row` answers `where` as a database comparing text loosely does:
 * case aside, so a row the exact comparison must refuse can come back.
 */
function loosely(where: unknown, row: Record<string, unknown>): boolean {
  const clause = where as Record<string, unknown>;
  if (Array.isArray(clause.or)) {
    return clause.or.some(part => loosely(part, row));
  }
  return Object.entries(clause).every(([field, test]) => {
    const wanted = (test as { equals?: unknown }).equals;
    const value = row[field];
    return (
      typeof value === "string" &&
      typeof wanted === "string" &&
      value.toLowerCase() === wanted.toLowerCase()
    );
  });
}

/**
 * A templates collection holding `rows`, answering a published read with
 * the published rows alone, as the Direct API does, and recording each read.
 */
function templatesHolding(rows: readonly Record<string, unknown>[]) {
  const reads: Record<string, unknown>[] = [];
  return {
    reads,
    nextly: {
      find: async (args: Record<string, unknown>) => {
        reads.push(args);
        const answered = rows.filter(
          row =>
            (args.status !== "published" || row.status === "published") &&
            loosely(args.where, row)
        );
        return { items: answered.slice(0, Number(args.limit ?? 10)) };
      },
    },
  };
}

describe("the design an entry is drawn with", () => {
  it("is its own published design over its collection's template, in one read of the published rows as the public reads them", async () => {
    // The template first, so the own design is chosen for what it is, not
    // for where it comes back.
    const held = templatesHolding([TEMPLATE_ROW, OWN_ROW]);
    const content = pageBuilderContent({ nextly: held.nextly });
    expect(await content.templates.readFor("posts", "p 1", "fr")).toEqual({
      id: "own-1",
      document: design("own"),
    });
    expect(held.reads).toEqual([
      {
        collection: "templates",
        where: {
          or: [
            { entry: { equals: "posts/p%201" } },
            { collection: { equals: "posts" } },
          ],
        },
        status: "published",
        overrideAccess: false,
        select: { id: true, collection: true, entry: true, content: true },
        limit: 2,
        depth: 0,
        locale: "fr",
      },
    ]);
  });

  it("is its collection's template while its own design is a draft", async () => {
    const held = templatesHolding([
      TEMPLATE_ROW,
      { ...OWN_ROW, status: "draft" },
    ]);
    const content = pageBuilderContent({ nextly: held.nextly });
    expect(await content.templates.readFor("posts", "p 1", undefined)).toEqual({
      id: "t1",
      document: design("template"),
    });
  });

  it("is its collection's template when it has no own design, another entry's own design not taken for it", async () => {
    const held = templatesHolding([TEMPLATE_ROW, OWN_ROW]);
    const content = pageBuilderContent({ nextly: held.nextly });
    expect(await content.templates.readFor("posts", "p2", undefined)).toEqual({
      id: "t1",
      document: design("template"),
    });
  });

  it("compares what comes back exactly, so a loose match is no design", async () => {
    // Another collection's entry, whose key matches this one's but for case.
    const held = templatesHolding([
      TEMPLATE_ROW,
      { ...OWN_ROW, id: "own-2", entry: "Posts/p%201" },
    ]);
    const content = pageBuilderContent({ nextly: held.nextly });
    expect(await content.templates.readFor("posts", "p 1", undefined)).toEqual({
      id: "t1",
      document: design("template"),
    });
    expect(
      await content.templates.readFor("POSTS", "p 1", undefined)
    ).toBeNull();
  });

  it("is null when there is neither", async () => {
    const held = templatesHolding([{ ...TEMPLATE_ROW, status: "draft" }]);
    const content = pageBuilderContent({ nextly: held.nextly });
    expect(
      await content.templates.readFor("posts", "p 1", undefined)
    ).toBeNull();
  });
});
