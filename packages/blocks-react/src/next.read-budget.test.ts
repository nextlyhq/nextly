/**
 * What a routed page's lists cost to read, counted where the reads land: the
 * Direct API below the route's real readers, which a fake answers from rows
 * in memory. A list's relations and links to entries are read in batches,
 * and its template image once, so a list of fifty posts costs what a list
 * of five does; a page
 * past its allowance still renders, its over-cap list drawing its designed
 * empty state, and the server log names the page, the cap and the blocks.
 */
import {
  defineNamedQuery,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { createPublicReader, type BindingSourceRef } from "nextly/runtime";
import { createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The field shapes the public reads, and a reader that hides nothing: no
// Nextly services are registered in this process to read a schema from.
const runtime = vi.hoisted(() => ({ shapes: new Map<string, unknown>() }));
vi.mock("nextly/runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("nextly/runtime")>();
  return {
    ...actual,
    createPublicReader: (
      ...[source, binding]: Parameters<typeof actual.createPublicReader>
    ) =>
      actual.createPublicReader(source, {
        ...binding,
        declarations: { hiddenFields: () => [] },
      }),
    bindingFieldShapes: async (ref: BindingSourceRef) =>
      runtime.shapes.get(
        "collection" in ref
          ? `collection:${ref.collection}`
          : `single:${ref.single}`
      ),
  };
});

import { throughBoundary } from "./__tests__/through-boundary";
import { coreBlocks } from "./blocks";
import {
  createDefaultDataProvider,
  createQueryBudget,
  createStandaloneContext,
  defineBlock,
  type BlocksDataProviderFactory,
  type NamedQueryLookup,
  type PageReadReport,
} from "./context";
import { createPublicBlocksPage, readBindingSources } from "./next";
import { countPageReads, type CountedRegion } from "./page-read-count";
import type { RouteMedia } from "./page-read-stages";
import type { PageRendererProps } from "./page-renderer";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

/**
 * A block holding a relation itself, as a contributed block may: what a
 * binding to the field (`author`) fills, the id the item stores.
 */
const writerBlock = defineBlock<{ writer?: string }>({
  name: "test/writer",
  version: 1,
  description: "Shows the writer it holds, by id.",
  example: { props: {} },
  props: { writer: { type: "relationship", relationTo: "authors" } },
  render: ({ props }) =>
    createElement("output", null, `writer:${String(props.writer)}`),
});

const blocks = createBlockResolver([...coreBlocks, writerBlock]);

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

/** Whether a stored row matches a Direct API `where`, as the database would. */
function matches(row: Row, where: unknown): boolean {
  if (where === undefined || where === null) return true;
  return Object.entries(where as Where).every(([key, condition]) => {
    if (key === "and") {
      return (condition as unknown[]).every(inner => matches(row, inner));
    }
    if (key === "or") {
      return (condition as unknown[]).some(inner => matches(row, inner));
    }
    const value = String(row[key]);
    return Object.entries(condition as Where).every(([op, operand]) => {
      switch (op) {
        case "equals":
          return value === String(operand);
        case "in":
          return (operand as unknown[]).map(String).includes(value);
        case "less_than":
          return value < String(operand);
        case "less_than_equal":
          return value <= String(operand);
        case "greater_than":
          return value > String(operand);
        case "greater_than_equal":
          return value >= String(operand);
        default:
          throw new Error(`The fake has no operator "${op}".`);
      }
    });
  });
}

/** A site of `count` posts, each with an author, an image and a page. */
function site(
  count: number,
  document: BlockDocument,
  options: {
    /**
     * Answer a read by `id in` with a count one higher than its rows, as a
     * read hook dropping a row would: a batch the route cannot trust.
     */
    readonly distrustBatches?: boolean;
  } = {}
) {
  const ids = Array.from({ length: count }, (_, index) => index + 1);
  const stored: Record<string, Row[]> = {
    pages: [{ id: "p1", slug: "journal", title: "Journal", content: document }],
    posts: ids.map(index => ({
      id: `post-${String(index)}`,
      slug: `post-${String(index)}`,
      title: `Post number ${String(index)}`,
      author: `author-${String(index % 7)}`,
      featuredImage: `image-${String(index)}`,
    })),
    authors: Array.from({ length: 7 }, (_, index) => ({
      id: `author-${String(index)}`,
      slug: `writer-${String(index)}`,
      name: `Writer ${String(index)}`,
    })),
    images: ids.map(index => ({
      id: `image-${String(index)}`,
      url: `/media/${String(index)}.jpg`,
      altText: `Picture ${String(index)}`,
    })),
  };
  const find = vi.fn(async (args: Row) => {
    const all = (stored[String(args.collection)] ?? []).filter(row =>
      matches(row, args.where)
    );
    const limit = typeof args.limit === "number" ? args.limit : all.length;
    // The window asked for, by an offset or a page of `limit` rows.
    const start =
      typeof args.offset === "number"
        ? args.offset
        : typeof args.page === "number"
          ? (args.page - 1) * limit
          : 0;
    const select = args.select as Record<string, boolean> | undefined;
    const items = all
      .slice(start, start + limit)
      .map(row =>
        select === undefined
          ? row
          : Object.fromEntries(
              Object.entries(row).filter(([key]) => select[key] === true)
            )
      );
    const batched = JSON.stringify(args.where ?? {}).includes('"id":{"in"');
    const total =
      options.distrustBatches === true && batched ? all.length + 1 : all.length;
    return { items, meta: { total } };
  });
  const findByID = vi.fn(async () => null);
  const mediaById = vi.fn(async () => null);
  // The media library's batch read, answering from the same images.
  const mediaByIds = vi.fn(async (args: { ids: readonly string[] }) =>
    (stored.images ?? []).filter(row => args.ids.includes(String(row.id)))
  );
  const publicSiteSettings = vi.fn(async () => ({
    siteName: "Journal",
    timezone: "UTC",
  }));
  return {
    find,
    findByID,
    publicSiteSettings,
    media: { findByID: mediaById, findByIDs: mediaByIds },
    stored,
  };
}

/** Every read the fake answered, of any kind, so far. */
function readsSoFar(nextly: Site): number {
  return (
    nextly.find.mock.calls.length +
    nextly.findByID.mock.calls.length +
    nextly.publicSiteSettings.mock.calls.length +
    nextly.media.findByID.mock.calls.length +
    nextly.media.findByIDs.mock.calls.length
  );
}

/** A page of one list of posts: a title, an author's name, an image, a link. */
function listing(
  limit: number,
  options: {
    /** Leave each entry's link out by a condition no entry meets. */
    readonly linkHidden?: boolean;
    /** The list's props in place of a plain list of posts. */
    readonly list?: Record<string, unknown>;
    /** More blocks for each entry's template. */
    readonly more?: readonly BlockNode[];
    /** Each entry's image bound to its own featured image. */
    readonly boundImage?: boolean;
  } = {}
): BlockDocument {
  const itemText = (id: string, path: string) => ({
    id,
    type: "core/heading",
    version: 1,
    props: { text: "", level: "h3" },
    bindings: { text: { $bind: path, source: "item", fallback: "None" } },
  });
  return JSON.parse(
    JSON.stringify({
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "posts",
          type: "core/collection-loop",
          version: 1,
          props: options.list ?? { collection: "posts", limit },
          slots: {
            children: [
              itemText("title", "title"),
              itemText("author", "author.name"),
              // One picture for every entry: a bound image is filled only
              // once it carries its whole media object, which main does not
              // do yet, so the template's image is set, read once.
              options.boundImage === true
                ? {
                    id: "picture",
                    type: "core/image",
                    version: 1,
                    props: { alt: "" },
                    bindings: {
                      mediaId: { $bind: "featuredImage", source: "item" },
                    },
                  }
                : {
                    id: "picture",
                    type: "core/image",
                    version: 1,
                    props: { alt: "", mediaId: "image-1" },
                  },
              {
                id: "more",
                type: "core/button",
                version: 1,
                props: { label: "Read", entryCollection: "posts" },
                ...(options.linkHidden === true
                  ? {
                      visibility: {
                        conditions: [
                          [{ field: "title", op: "equals", value: "No post" }],
                        ],
                      },
                    }
                  : {}),
                bindings: { entryId: { $bind: "id", source: "item" } },
              },
              ...(options.more ?? []),
            ],
            empty: [
              {
                id: "none",
                type: "core/text",
                version: 1,
                props: { text: "Nothing to read yet." },
              },
            ],
          },
        },
      ],
    })
  ) as BlockDocument;
}

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return await new Response(stream).text();
}

type Site = ReturnType<typeof site>;

/** Past the quiet the route waits for before it logs a page's overrun. */
async function quiet(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 120));
}

/** The page at `/journal` rendered, and the reads it made below the route. */
async function journal(
  nextly: Site,
  config: {
    maxQueries?: number;
    data?: BlocksDataProviderFactory;
    collections?: string[];
    locale?: string;
    namedQueries?: NamedQueryLookup;
    timeZone?: string;
    /** The address visited, `/journal` by default. */
    path?: string[];
    mediaLibrary?: boolean;
    cacheScope?: string;
  } = {}
): Promise<{ html: string; reads: Row[]; total: number }> {
  return await rendered(nextly, {
    collections: ["pages", "posts"],
    field: "content",
    slug: "journal",
    ...config,
  });
}

/**
 * A page rendered through the public route, and the reads it made after the
 * route resolved it (which the page's allowance does not count): each
 * `find`, and the total of every kind of read.
 */
async function rendered(
  nextly: Site,
  config: {
    collections: string[];
    field: string;
    slug: string;
    maxQueries?: number;
    data?: BlocksDataProviderFactory;
    locale?: string;
    namedQueries?: NamedQueryLookup;
    timeZone?: string;
    path?: string[];
    /** Read images from the media library, not a named collection. */
    mediaLibrary?: boolean;
    cacheScope?: string;
    /** Draw without the lists' read-ahead, as each entry read one by one. */
    oneByOne?: boolean;
  }
): Promise<{ html: string; reads: Row[]; total: number }> {
  const { slug, oneByOne, path, mediaLibrary, ...route } = config;
  const page = createPublicBlocksPage({
    blocks,
    ...(mediaLibrary === true ? {} : { mediaCollection: "images" }),
    ...route,
    nextly: nextly as never,
  });
  // The route resolving the page reads before the render's reads; the
  // bindings' sources and the blocks read after it, under the allowance.
  const resolved = readsSoFar(nextly);
  const before = nextly.find.mock.calls.length;
  const element = await throughBoundary<PageRendererProps>(
    page.ContentPage({ params: { slug: path ?? [slug] } })
  );
  const props =
    oneByOne === true ? withoutReadAhead(element.props) : element.props;
  const html = await renderToHtml(createElement(PageRenderer, props));
  const reads = nextly.find.mock.calls
    .slice(before)
    .map(([args]) => args)
    // The route's own read of the entry by its address.
    .filter(args => !JSON.stringify(args.where ?? {}).includes(`"${slug}"`));
  const total =
    readsSoFar(nextly) -
    resolved -
    (nextly.find.mock.calls.length - before - reads.length);
  return { html, reads, total };
}

/** Renderer props whose lists read each entry's data as it is drawn. */
function withoutReadAhead(props: PageRendererProps): PageRendererProps {
  const { listReads: _dropped, ...context } = props.context ?? {};
  return { ...props, context } as PageRendererProps;
}

/** Each read as its collection and the shape of its filter, for a reader. */
function described(reads: readonly Row[]): string[] {
  return reads.map(args => {
    const where = JSON.stringify(args.where ?? {});
    const kind = where.includes('"or"')
      ? "count of pairs"
      : where.includes('"id":{"in"')
        ? "by ids"
        : where.includes('"slug":{"in"')
          ? "by slugs"
          : "query";
    return `${String(args.collection)}: ${kind}`;
  });
}

// Each test a quarter of an hour after the last, as the process sees it, so
// one test's overrun line does not hold back the next one's.
const startedAt = Date.now();
let minutesOn = 0;
function later(minutes: number): void {
  minutesOn += minutes;
  vi.spyOn(Date, "now").mockImplementation(
    () => startedAt + minutesOn * 60_000
  );
}

beforeEach(() => {
  later(15);
  runtime.shapes = new Map<string, unknown>([
    ["collection:pages", [{ name: "title", type: "text" }]],
    [
      "collection:posts",
      [
        { name: "title", type: "text" },
        { name: "slug", type: "text" },
        { name: "author", type: "relationship", relationTo: "authors" },
        { name: "featuredImage", type: "upload", relationTo: "images" },
      ],
    ],
    ["collection:authors", [{ name: "name", type: "text" }]],
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a list's reads", () => {
  it("a list of 50 posts, each with an author, an image and a link to its page, costs what a list of 5 does", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fifty = site(50, listing(50));
    const { html, reads, total } = await journal(fifty);
    // Every entry drawn with its own values, through its relation, its image
    // and its link.
    for (const index of [1, 17, 50]) {
      expect(html).toContain(`Post number ${String(index)}`);
      expect(html).toContain(`href="/post-${String(index)}"`);
    }
    expect(html.split("/media/1.jpg")).toHaveLength(51);
    expect(html).toContain("Writer 3");
    expect(html).not.toContain("None");
    // In page order: the list's entries; its authors by id; its image by
    // id; its links: their rows by id, then the three ownership checks as
    // counts over all of them (the pair stored, no lower id, no earlier
    // collection).
    expect(described(reads)).toEqual([
      "posts: query",
      "authors: by ids",
      "images: by ids",
      "posts: by ids",
      "posts: count of pairs",
      "posts: count of pairs",
      "pages: by slugs",
    ]);
    expect(fifty.media.findByID).not.toHaveBeenCalled();
    expect(total).toBe(7);

    const five = site(5, listing(5));
    const small = await journal(five);
    expect(small.html).toContain(`href="/post-5"`);
    expect(small.total).toBe(total);
  });

  it("a page past its allowance still renders: the list draws its empty state, and the log names the page, the cap and the list", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nextly = site(50, listing(50));
    const { html, reads } = await journal(nextly, { maxQueries: 0 });
    expect(html).toContain("Nothing to read yet.");
    expect(html).not.toContain("Post number");
    expect(reads).toEqual([]);
    await quiet();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[blocks] "pages" page "journal" needed more than its 0 reads: at least 1 read(s) refused; 1 block(s) drawn as if their data were missing: posts.'
    );
  });

  it("a cap reached part-way through names each block that went without its data, and stops reading", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nextly = site(50, listing(50));
    // The entries and their authors, then nothing: the links are not asked
    // ahead, since the allowance left could not cover a batch that fell
    // back, and are refused as each block asks, as is the image.
    const { html, reads } = await journal(nextly, { maxQueries: 2 });
    expect(html).toContain("Post number 50");
    expect(html).toContain("Writer 1");
    expect(html).not.toContain("/media/");
    expect(html).not.toContain('href="/post-');
    expect(described(reads)).toEqual(["posts: query", "authors: by ids"]);
    await quiet();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[blocks] "pages" page "journal" needed more than its 2 reads: at least 100 read(s) refused; 2 block(s) drawn as if their data were missing: picture, more.'
    );
  });
});

/** A post page drawn with the builder: the post's own fields bound. */
function postPage(): BlockDocument {
  const bound = (
    id: string,
    type: string,
    props: Record<string, unknown>,
    bindings: Record<string, unknown>
  ) => ({ id, type, version: 1, props, bindings });
  const related = (id: string, collection: string) => ({
    id,
    type: "core/collection-loop",
    version: 1,
    props: {
      collection,
      relation: { of: "entry", field: collection },
      limit: 10,
    },
    slots: {
      children: [
        bound(
          `${id}-name`,
          "core/text",
          { text: "" },
          {
            text: { $bind: "title", source: "item" },
          }
        ),
      ],
    },
  });
  return JSON.parse(
    JSON.stringify({
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        bound(
          "title",
          "core/heading",
          { text: "", level: "h1" },
          {
            text: { $bind: "title" },
          }
        ),
        bound(
          "date",
          "core/text",
          { text: "" },
          {
            text: { $bind: "publishedAt", format: { type: "date" } },
          }
        ),
        bound(
          "minutes",
          "core/text",
          { text: "" },
          {
            text: { $bind: "readingTime" },
          }
        ),
        bound(
          "excerpt",
          "core/text",
          { text: "" },
          {
            text: { $bind: "excerpt" },
          }
        ),
        bound(
          "cover",
          "core/image",
          { alt: "" },
          {
            mediaId: { $bind: "featuredImage" },
          }
        ),
        bound(
          "byline",
          "core/text",
          { text: "" },
          {
            text: { $bind: "author.name" },
          }
        ),
        bound(
          "avatar",
          "core/image",
          { alt: "" },
          {
            src: { $bind: "author.avatarUrl" },
          }
        ),
        related("categories", "categories"),
        related("tags", "tags"),
        bound(
          "social",
          "core/image",
          { alt: "" },
          {
            mediaId: { $bind: "socialImage" },
          }
        ),
      ],
    })
  ) as BlockDocument;
}

describe("what a list reads ahead, and through what", () => {
  it("reads a relation through the page's own data provider, so one that does not serve its collection reads none", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nextly = site(5, listing(5));
    const { html, reads } = await journal(nextly, {
      // Lists may read posts, and nothing else.
      data: reader =>
        createDefaultDataProvider(reader, { collections: ["posts"] }),
    });
    expect(html).toContain("Post number 5");
    // The author binding shows its fallback: the relation was not read.
    expect(html).toContain(">None<");
    expect(html).not.toContain("Writer");
    expect(reads.map(args => args.collection)).not.toContain("authors");
    warn.mockRestore();
  });

  it("reads nothing for a block each entry's conditions leave out, and still reads what the entries draw", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nextly = site(5, listing(5, { linkHidden: true }));
    // Room for the entries, their authors and the template's image only: a
    // read for the hidden links would be refused, and logged.
    const { html, reads } = await journal(nextly, { maxQueries: 3 });
    expect(html).toContain("Writer 1");
    expect(html).toContain("/media/1.jpg");
    expect(html).not.toContain(">Read<");
    expect(described(reads)).toEqual([
      "posts: query",
      "authors: by ids",
      "images: query",
    ]);
    await quiet();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("a list's relations and links, read ahead", () => {
  it("keeps the id an item stores for a binding to the relation itself, and reads the related entry for one through it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nextly = site(
      5,
      listing(5, {
        more: [
          {
            id: "writer",
            type: "test/writer",
            version: 1,
            props: {},
            bindings: { writer: { $bind: "author", source: "item" } },
          },
        ],
      })
    );
    const { html } = await journal(nextly);
    // Through it, for the author heading: the related entry's field.
    expect(html).toContain("Writer 1");
    // To it: the id the item stores, on the same item.
    expect(html).toContain("<output>writer:author-1</output>");
  });

  it("reads ahead for a custom source whose rows are a collection's entries, as for that collection's list", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ahead = defineNamedQuery({
      name: "posts.picked",
      label: "Picked posts",
      reads: { collections: ["posts"] },
      rows: { collection: "posts" },
      run: () =>
        Promise.resolve({
          rows: [1, 2, 3].map(index => ({
            id: `post-${String(index)}`,
            title: `Post number ${String(index)}`,
            author: `author-${String(index)}`,
          })),
        }),
    });
    const nextly = site(
      5,
      listing(3, {
        list: { namedQuery: { name: "posts.picked", params: {} }, limit: 3 },
      })
    );
    const { html, reads } = await journal(nextly, {
      timeZone: "Asia/Karachi",
      namedQueries: {
        definitionOf: name => (name === ahead.name ? ahead : undefined),
      },
    });
    expect(html).toContain("Writer 2");
    expect(html).toContain('href="/post-3"');
    // One read of the authors and one of the links' rows, for all three.
    expect(described(reads)).toEqual(
      expect.arrayContaining(["authors: by ids", "posts: by ids"])
    );
    expect(
      described(reads).filter(read => read === "authors: by ids")
    ).toHaveLength(1);
    expect(
      described(reads).filter(read => read === "posts: by ids")
    ).toHaveLength(1);
  });
});

/** A page of the given nodes. */
function pageOf(nodes: readonly unknown[]): BlockDocument {
  return JSON.parse(
    JSON.stringify({
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes,
    })
  ) as BlockDocument;
}

/** A list of posts drawing `children` for each. */
function postsList(id: string, limit: number, children: readonly unknown[]) {
  return {
    id,
    type: "core/collection-loop",
    version: 1,
    props: { collection: "posts", limit },
    slots: { children },
  };
}

/** A heading bound to a list item's path. */
function itemHeading(id: string, path: string, fallback: string) {
  return {
    id,
    type: "core/heading",
    version: 1,
    props: { text: "", level: "h3" },
    bindings: { text: { $bind: path, source: "item", fallback } },
  };
}

describe("a list's read-ahead, at its edges", () => {
  it("never draws an inner list's item with what was read for the outer one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nextly = site(
      5,
      pageOf([
        postsList("outer", 1, [
          itemHeading("outer-author", "author.name", "Outer none"),
          postsList("inner", 1, [
            itemHeading("inner-author", "author.name", "Inner none"),
          ]),
        ]),
      ])
    );
    // The outer list, its authors and the inner list; the inner list's
    // authors are refused.
    const { html } = await journal(nextly, { maxQueries: 3 });
    expect(html).toContain(">Writer 1<");
    expect(html.split("Writer 1")).toHaveLength(2);
    expect(html).toContain(">Inner none<");
  });

  it("reads no link ahead for an image with nothing to draw, nor an icon naming none", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const linked = { entryCollection: "posts" };
    const byId = { entryId: { $bind: "id", source: "item" } };
    const nextly = site(
      5,
      pageOf([
        postsList("list", 3, [
          {
            id: "pic",
            type: "core/image",
            version: 1,
            props: { alt: "", ...linked },
            bindings: byId,
          },
          {
            id: "mark",
            type: "core/icon",
            version: 1,
            props: { ...linked },
            bindings: byId,
          },
        ]),
      ])
    );
    const { html, reads } = await journal(nextly, { maxQueries: 20 });
    expect(html).not.toContain('href="/post-');
    // The entries alone: neither block draws, so neither reads its link.
    expect(described(reads)).toEqual(["posts: query"]);
  });

  it("goes link by link when the allowance covers only that, so a link keeps its address", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nextly = site(
      5,
      pageOf([
        postsList("list", 1, [
          {
            id: "more",
            type: "core/button",
            version: 1,
            props: { label: "Read", entryCollection: "posts" },
            bindings: { entryId: { $bind: "id", source: "item" } },
          },
        ]),
      ]),
      { distrustBatches: true }
    );
    // The entries, then exactly one link's own reads: its row, the two
    // checks in its collection and one for the collection before it.
    const { html } = await journal(nextly, { maxQueries: 1 + 4 });
    expect(html).toContain('href="/post-1"');
  });
});

describe("a list's read-ahead, in the order the page draws", () => {
  const button = (id: string, collection: string, entryId: unknown) => ({
    id,
    type: "core/button",
    version: 1,
    props: {
      label: id,
      entryCollection: collection,
      ...(typeof entryId === "string" ? { entryId } : {}),
    },
    ...(typeof entryId === "object" ? { bindings: { entryId } } : {}),
  });

  it("reads its links ahead in page order, so under a tight cap the earlier block keeps its address", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nextly = site(
      5,
      pageOf([
        postsList("list", 1, [
          // First on the page: a link to the page itself.
          button("first", "pages", "p1"),
          button("second", "posts", { $bind: "id", source: "item" }),
        ]),
      ])
    );
    // The entries, then room for the first link's batch and nothing past it.
    const { html, reads } = await journal(nextly, { maxQueries: 1 + 6 });
    expect(html).toContain('href="/journal"');
    const order = described(reads);
    expect(order.indexOf("pages: by ids")).toBeGreaterThan(-1);
    expect(order).not.toContain("posts: by ids");
  });

  it("reads ahead for the entry a link's binding falls back to", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nextly = site(
      5,
      pageOf([
        postsList("list", 2, [
          button("more", "posts", {
            $bind: "noSuchField",
            source: "item",
            fallback: "post-3",
          }),
        ]),
      ])
    );
    const { html, reads } = await journal(nextly);
    expect(html).toContain('href="/post-3"');
    // The fallback's entry read ahead, in the batch: the only plain query of
    // posts is the list's own.
    expect(
      described(reads).filter(read => read === "posts: query")
    ).toHaveLength(1);
    expect(described(reads)).toContain("posts: by ids");
  });

  it("draws a refused inner list's empty state with no item, not the outer list's", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const inner = {
      ...postsList("inner", 1, []),
      slots: {
        children: [],
        empty: [itemHeading("inner-empty", "title", "No title")],
      },
    };
    const nextly = site(
      5,
      pageOf([
        postsList("outer", 1, [
          itemHeading("outer-title", "title", "None"),
          inner,
        ]),
      ])
    );
    // The outer list's entries, and nothing for the inner list.
    const { html } = await journal(nextly, { maxQueries: 1 });
    expect(html).toContain(">No title<");
    expect(html.split("Post number 1<")).toHaveLength(2);
  });
});

describe("a list's images, read ahead", () => {
  it("reads a hundred entries' own images in one read through the media library", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The posts' picture is an upload to the media library, the collection
    // a route without a media collection of its own reads images from.
    runtime.shapes.set("collection:posts", [
      { name: "title", type: "text" },
      { name: "slug", type: "text" },
      { name: "author", type: "relationship", relationTo: "authors" },
      { name: "featuredImage", type: "upload", relationTo: "media" },
    ]);
    const nextly = site(100, listing(100, { boundImage: true }));
    const { html, total } = await journal(nextly, { mediaLibrary: true });
    expect(html).toContain("/media/1.jpg");
    expect(html).toContain("/media/100.jpg");
    expect(nextly.media.findByIDs).toHaveBeenCalledOnce();
    expect(nextly.media.findByID).not.toHaveBeenCalled();
    // The entries, the authors, the images and the links' four.
    expect(total).toBe(7);
  });

  it("keeps the first block's link its address when the cap covers exactly that link", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nextly = site(
      5,
      pageOf([
        postsList("list", 1, [
          {
            id: "more",
            type: "core/button",
            version: 1,
            props: { label: "Read", entryCollection: "posts" },
            bindings: { entryId: { $bind: "id", source: "item" } },
          },
          // After the link on the page: its relation is not read first.
          itemHeading("author", "author.name", "No author"),
        ]),
      ])
    );
    // The entries, then exactly the link's own reads: its row, the two
    // checks in its collection and one for the collection before it.
    const { html } = await journal(nextly, { maxQueries: 1 + 4 });
    expect(html).toContain('href="/post-1"');
    expect(html).toContain(">No author<");
  });
});

describe("a page drawn inside its Layout", () => {
  it("hands each region the blocks kept for its own conditions, not the page's", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Kept where the page's entry is titled "Journal", as it is.
    const kept = (id: string) => ({
      id,
      type: "core/heading",
      version: 1,
      props: { text: id, level: "h2" },
      visibility: {
        conditions: [[{ field: "title", op: "equals", value: "Journal" }]],
      },
    });
    const nextly = site(1, pageOf([kept("page-kept")]));
    nextly.stored.layouts = [
      { id: "main", areas: [{ area: "header", component: "head" }] },
    ];
    nextly.stored.components = [
      {
        id: "head",
        content: {
          formatVersion: DOCUMENT_FORMAT_VERSION,
          kind: "component",
          nodes: [kept("region-kept")],
        },
      },
    ];
    const route = createPublicBlocksPage({
      collections: ["pages", "posts"],
      field: "content",
      blocks,
      layouts: {
        readDefault: () => Promise.resolve("main"),
        singles: ["page-builder-settings"],
      },
      nextly: nextly as never,
    });
    const element = await throughBoundary<{ children?: unknown }>(
      route.ContentPage({ params: { slug: ["journal"] } })
    );
    // The header, then the page.
    const [header, page] = element.props.children as ReactElement<{
      children?: ReactElement<PageRendererProps>;
      context?: PageRendererProps["context"];
    }>[];
    const regionHeld = header?.props.children?.props.context?.heldConditions;
    const pageHeld = page?.props.context?.heldConditions;
    // The region's one kept block, by the id it is drawn with inside its
    // component; the page's own, by its id. Neither holds the other's.
    expect(regionHeld?.size).toBe(1);
    expect(regionHeld?.has("page-kept")).toBe(false);
    expect([...(pageHeld ?? [])]).toEqual(["page-kept"]);
  });
});

describe("the overrun line", () => {
  it("is said once per page in ten minutes, however often the page renders over its cap", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nextly = site(5, listing(5));
    await journal(nextly, { maxQueries: 0 });
    await quiet();
    await journal(nextly, { maxQueries: 0 });
    await quiet();
    later(9);
    await journal(nextly, { maxQueries: 0 });
    await quiet();
    expect(warn).toHaveBeenCalledTimes(1);
    // Past ten minutes, the same page says it again.
    later(2);
    await journal(nextly, { maxQueries: 0 });
    await quiet();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1]?.[0])).toContain('"pages" page "journal"');
  });

  it("says each cache scope of a page apart", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nextly = site(5, listing(5));
    await journal(nextly, { maxQueries: 0, cacheScope: "site-a" });
    await quiet();
    await journal(nextly, { maxQueries: 0, cacheScope: "site-b" });
    await quiet();
    await journal(nextly, { maxQueries: 0, cacheScope: "site-b" });
    await quiet();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("says each language of a page apart", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nextly = site(5, listing(5));
    await journal(nextly, { maxQueries: 0, locale: "en" });
    await quiet();
    await journal(nextly, { maxQueries: 0, locale: "fr" });
    await quiet();
    await journal(nextly, { maxQueries: 0, locale: "fr" });
    await quiet();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("says each page of a page's list apart", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Ten posts a page, so the list has five; room for each page's entries
    // and their authors, and none for their links.
    const nextly = site(
      50,
      listing(10, {
        list: { collection: "posts", limit: 10, paginate: true },
      })
    );
    const first = await journal(nextly, { maxQueries: 2 });
    expect(first.html).toContain("Post number 1<");
    await quiet();
    const second = await journal(nextly, {
      maxQueries: 2,
      path: ["journal", "page", "2"],
    });
    expect(second.html).toContain("Post number 11<");
    await quiet();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("what a page costs to read, measured", () => {
  it("the rebuilt post page, and a 100-item listing with and without the read-ahead", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    runtime.shapes.set("collection:posts", [
      { name: "title", type: "text" },
      { name: "slug", type: "text" },
      { name: "excerpt", type: "text" },
      { name: "readingTime", type: "number" },
      { name: "publishedAt", type: "date" },
      { name: "author", type: "relationship", relationTo: "authors" },
      { name: "featuredImage", type: "upload", relationTo: "images" },
      { name: "socialImage", type: "upload", relationTo: "images" },
      {
        name: "categories",
        type: "relationship",
        relationTo: "categories",
        hasMany: true,
      },
      { name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
    ]);
    runtime.shapes.set("collection:authors", [
      { name: "name", type: "text" },
      { name: "avatarUrl", type: "text" },
    ]);
    runtime.shapes.set("collection:categories", [
      { name: "title", type: "text" },
    ]);
    runtime.shapes.set("collection:tags", [{ name: "title", type: "text" }]);

    const blog = site(3, postPage());
    blog.stored.posts = [
      {
        id: "post-1",
        slug: "hello",
        title: "Hello, reader",
        excerpt: "A first post.",
        readingTime: 4,
        publishedAt: "2026-11-01",
        author: "author-1",
        featuredImage: "image-1",
        socialImage: "image-2",
        categories: ["cat-1", "cat-2"],
        tags: ["tag-1", "tag-2", "tag-3"],
        design: postPage(),
      },
    ];
    blog.stored.authors = [
      { id: "author-1", name: "Ada", avatarUrl: "https://example.com/ada.png" },
    ];
    blog.stored.categories = [
      { id: "cat-1", title: "Craft" },
      { id: "cat-2", title: "Calm" },
    ];
    blog.stored.tags = [
      { id: "tag-1", title: "react" },
      { id: "tag-2", title: "cms" },
      { id: "tag-3", title: "reads" },
    ];
    const post = await rendered(blog, {
      collections: ["posts"],
      field: "design",
      slug: "hello",
    });
    expect(post.html).toContain("Hello, reader");
    expect(post.html).toContain("Ada");
    expect(post.html).toContain("Calm");
    expect(post.html).toContain("reads");

    const ahead = await journal(site(100, listing(100)));
    // Each entry's own picture, bound: read in one batch, with the others.
    const bound = await journal(site(100, listing(100, { boundImage: true })));
    expect(bound.html).toContain("/media/100.jpg");
    // The same seven reads as one image: the hundred are one batch.
    expect(bound.total).toBe(7);
    const oneByOne = await rendered(site(100, listing(100)), {
      collections: ["pages", "posts"],
      field: "content",
      slug: "journal",
      oneByOne: true,
    });
    expect(oneByOne.html).toContain('href="/post-100"');
    const measured = {
      postPage: { reads: post.total, finds: described(post.reads) },
      listing100: { reads: ahead.total },
      listing100BoundImages: { reads: bound.total },
      listing100OneByOne: { reads: oneByOne.total },
    };
    const out = process.env.READ_BUDGET_MEASUREMENTS;
    if (out !== undefined && out !== "") {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(out, `${JSON.stringify(measured, null, 2)}\n`);
    }
    expect(ahead.total).toBe(7);
    // Each link's four reads, the entries and the one image: the author
    // names, never followed without the read-ahead, fall back.
    expect(oneByOne.total).toBe(402);
  });
});

/**
 * A page holding each stage the route reads before it draws: a component
 * placing another, a block kept by an entry condition that holds, a list
 * filtered by a day and split into pages, whose entries follow a relation
 * and link by an item-bound id, all inside the header of the Layout the
 * page names.
 */
function everyStage(): {
  nextly: Site;
  definitions: Map<string, BlockDocument>;
} {
  const component = (nodes: readonly unknown[]): BlockDocument =>
    ({ ...pageOf(nodes), kind: "component" }) as BlockDocument;
  const instance = (id: string, componentId: string) => ({
    id,
    type: "nextly/component-instance",
    version: 1,
    props: { componentId },
  });
  const document = pageOf([
    instance("outer-placed", "outer"),
    {
      id: "kept",
      type: "core/image",
      version: 1,
      props: { alt: "", mediaId: "image-2" },
      visibility: {
        conditions: [[{ field: "title", op: "equals", value: "Journal" }]],
      },
    },
    {
      ...postsList("posts", 3, [
        itemHeading("title", "title", "None"),
        itemHeading("author", "author.name", "No author"),
        // Each entry's own picture, read ahead with the others in a batch.
        {
          id: "cover",
          type: "core/image",
          version: 1,
          props: { alt: "" },
          bindings: { mediaId: { $bind: "featuredImage", source: "item" } },
        },
        {
          id: "more",
          type: "core/button",
          version: 1,
          props: { label: "Read", entryCollection: "posts" },
          bindings: { entryId: { $bind: "id", source: "item" } },
        },
      ]),
      props: {
        collection: "posts",
        limit: 3,
        paginate: true,
        filters: [
          { field: "publishedAt", op: "greater_than", value: "2026-01-01" },
        ],
      },
    },
  ]);
  const nextly = site(9, document);
  for (const post of nextly.stored.posts ?? []) post.publishedAt = "2026-06-01";
  const definitions = new Map<string, BlockDocument>([
    ["outer", component([instance("inner-placed", "inner")])],
    [
      "inner",
      component([
        {
          id: "inner-picture",
          type: "core/image",
          version: 1,
          props: { alt: "", mediaId: "image-1" },
        },
      ]),
    ],
    ["head", component([postsList("head-list", 2, [])])],
  ]);
  nextly.stored.components = [...definitions].map(([id, content]) => ({
    id,
    content,
  }));
  nextly.stored.layouts = [
    { id: "main", areas: [{ area: "header", component: "head" }] },
  ];
  // The page names its Layout, so the route reads that Layout's row alone:
  // the editor draws the Layout it resolved, and a default's resolution is
  // the route's own (the count's stated limit).
  for (const page of nextly.stored.pages ?? []) page.layout = "main";
  return { nextly, definitions };
}

/** The budget a rendered element's page drew under, wherever it sits. */
function reportIn(element: unknown): PageReadReport | undefined {
  const props = (element as { props?: Record<string, unknown> } | null)?.props;
  if (props === undefined) return undefined;
  const queries = (props.context as { queries?: unknown } | undefined)?.queries;
  if (queries !== undefined) {
    return (queries as { report(): PageReadReport }).report();
  }
  const children = props.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = reportIn(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The editor's count of the page at `/journal`, made from the same site the
 * route reads: lists through the public's reader, the bindings and
 * conditions read as the route reads them under the reads left (as the
 * canvas bindings route does), images from the stored rows.
 */
async function editorCount(
  nextly: Site,
  options: {
    readonly cap: number;
    readonly media: RouteMedia;
    readonly definitions?: Map<string, BlockDocument>;
    readonly regions?: CountedRegion[];
  }
): Promise<PageReadReport> {
  const reader = createPublicReader(
    { find: async args => (await nextly.find({ ...args })) as never },
    {}
  );
  const images = nextly.stored.images ?? [];
  return await countPageReads({
    drawnWith: {
      blocks,
      definitions: options.definitions ?? new Map(),
      context: createStandaloneContext({
        entry: { id: "p1" },
        entryCollection: "pages",
        data: createDefaultDataProvider(reader as never),
        resolveMedia: id => {
          const image = images.find(row => row.id === id);
          return Promise.resolve(
            image === undefined ? null : { url: String(image.url) }
          );
        },
      }),
    },
    document: (nextly.stored.pages?.[0]?.content ??
      pageOf([])) as BlockDocument,
    regions: options.regions ?? [],
    entrySource: "collection",
    where: {
      collection: "pages",
      slug: "journal",
      page: 1,
      listPagePath: page => `/journal/page/${String(page)}`,
    },
    readBindings: async (ask, allowance) => {
      const budget = createQueryBudget(allowance);
      const bindings = await readBindingSources({
        documents: ask.documents,
        ...(ask.conditions === undefined ? {} : { conditions: ask.conditions }),
        entrySource: "collection",
        slug: "pages",
        entryId: "p1",
        page: "journal",
        reader: reader as never,
        budget,
        siteSettings: nextly as never,
      });
      return bindings === undefined
        ? undefined
        : { bindings, reads: budget.report() };
    },
    draw: async element => {
      await renderToHtml(element);
    },
    cap: options.cap,
    media: options.media,
  });
}

/**
 * What a count reports, as two counts are compared: the reads made, by kind,
 * the blocks named unread, and whether any read was refused. How many were
 * refused is a lower bound on what the page needs (a read refused never asks
 * for what it would have led to), and it is not compared: the route asks a
 * refused link's reads again where the count stops at the first refused.
 */
function comparable(report: PageReadReport | undefined) {
  return {
    used: report?.used,
    refused: (report?.refused ?? 0) > 0,
    byKind: report?.byKind,
    unread: [...new Set(report?.unread.map(block => block.nodeId))].sort(),
  };
}

describe("the editor's count of a page's reads", () => {
  it("reads and refuses as the published route does, at every allowance", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    runtime.shapes.set("collection:posts", [
      { name: "title", type: "text" },
      { name: "slug", type: "text" },
      { name: "publishedAt", type: "date" },
      { name: "author", type: "relationship", relationTo: "authors" },
      { name: "featuredImage", type: "upload", relationTo: "images" },
    ]);
    const published = async (cap: number) => {
      const { nextly } = everyStage();
      const route = createPublicBlocksPage({
        collections: ["pages", "posts"],
        field: "content",
        blocks,
        mediaCollection: "images",
        maxQueries: cap,
        layouts: {
          readDefault: () => Promise.resolve("main"),
          singles: ["page-builder-settings"],
        },
        nextly: nextly as never,
      });
      const element = await throughBoundary<{ children?: unknown }>(
        route.ContentPage({ params: { slug: ["journal"] } })
      );
      const html = await renderToHtml(element);
      return { html, report: reportIn(element) };
    };
    const counted = async (cap: number) => {
      const { nextly, definitions } = everyStage();
      return await editorCount(nextly, {
        cap,
        definitions,
        regions: [
          {
            area: "header",
            document: pageOf([
              {
                id: "nextly-region-header",
                type: "nextly/component-instance",
                version: 1,
                props: { componentId: "head" },
              },
            ]),
            definitions,
          },
        ],
        media: { mediaCollection: "images" },
      });
    };
    const full = await published(500);
    // Every stage reached: the nested component's image, the kept block's,
    // the list's entries, their authors and their links.
    expect(full.html).toContain("/media/1.jpg");
    expect(full.html).toContain("/media/2.jpg");
    expect(full.html).toContain("Writer ");
    expect(full.html).toContain('href="/post-1"');
    // The entries' own pictures, read ahead in one batch.
    expect(full.html).toContain("/media/3.jpg");
    const most = full.report?.used ?? 0;
    expect(most).toBeGreaterThan(8);
    // Each allowance from none to past the page's need, both ways, compared
    // whole, so every allowance that differs is shown at once.
    const caps = Array.from({ length: most + 2 }, (_, cap) => cap);
    const route: unknown[] = [];
    const editor: unknown[] = [];
    for (const cap of caps) {
      route.push({ cap, ...comparable((await published(cap)).report) });
      editor.push({ cap, ...comparable(await counted(cap)) });
    }
    expect(editor).toEqual(route);
  });
});

describe("a component read refused for want of reads", () => {
  it("names the placements asking for it, as the blocks drawn without it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { nextly } = everyStage();
    // Room for the outer component's read alone: the inner one's, asked by
    // the block it is placed in, is refused.
    const route = createPublicBlocksPage({
      collections: ["pages", "posts"],
      field: "content",
      blocks,
      maxQueries: 1,
      nextly: nextly as never,
    });
    const element = await throughBoundary<{ children?: unknown }>(
      route.ContentPage({ params: { slug: ["journal"] } })
    );
    const report = reportIn(element);
    expect(report?.byKind).toEqual({ component: 1 });
    // The page's own placement, which the inner component is drawn inside:
    // the block an author placed and can select.
    expect(report?.unread).toContainEqual({
      nodeId: "outer-placed",
      what: "component",
    });
  });
});

describe("a list's images, counted as the route reads them", () => {
  it("counts one read per batch where the route batches, and one per image where it cannot", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const imagesRead = async (route: {
      readonly media: RouteMedia;
      readonly config: Record<string, unknown>;
    }) => {
      const nextly = site(3, listing(3, { boundImage: true }));
      const page = createPublicBlocksPage({
        collections: ["pages", "posts"],
        field: "content",
        blocks,
        mediaCollection: "images",
        ...route.config,
        nextly: nextly as never,
      });
      const element = await throughBoundary<{ children?: unknown }>(
        page.ContentPage({ params: { slug: ["journal"] } })
      );
      await renderToHtml(element);
      const counted = await editorCount(
        site(3, listing(3, { boundImage: true })),
        {
          cap: 500,
          media: route.media,
        }
      );
      return {
        route: reportIn(element)?.byKind.image,
        count: counted.byKind.image,
      };
    };
    // A named media collection: one read for the list's three images.
    expect(
      await imagesRead({ media: { mediaCollection: "images" }, config: {} })
    ).toEqual({ route: 1, count: 1 });
    // The site's own resolver takes one id: one read per image, both ways.
    expect(
      await imagesRead({
        media: { mediaCollection: "images", ownResolver: true },
        config: {
          resolveMedia: (id: string) =>
            Promise.resolve({ url: `/media/${id.slice(6)}.jpg` }),
        },
      })
    ).toEqual({ route: 3, count: 3 });
  });

  it("counts one read per image for a media library that reads one id at a time", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // The posts' pictures are uploads to the media library.
    runtime.shapes.set("collection:posts", [
      { name: "title", type: "text" },
      { name: "slug", type: "text" },
      { name: "author", type: "relationship", relationTo: "authors" },
      { name: "featuredImage", type: "upload", relationTo: "media" },
    ]);
    const nextly = site(3, listing(3, { boundImage: true }));
    // A media library with no read of many ids.
    Reflect.deleteProperty(nextly.media, "findByIDs");
    const page = createPublicBlocksPage({
      collections: ["pages", "posts"],
      field: "content",
      blocks,
      nextly: nextly as never,
    });
    const element = await throughBoundary<{ children?: unknown }>(
      page.ContentPage({ params: { slug: ["journal"] } })
    );
    await renderToHtml(element);
    const counted = await editorCount(
      site(3, listing(3, { boundImage: true })),
      { cap: 500, media: { libraryReadsMany: false } }
    );
    expect({
      route: reportIn(element)?.byKind.image,
      count: counted.byKind.image,
    }).toEqual({ route: 3, count: 3 });
    // CONTROL: the same count, for a library that reads many, batches.
    const batched = await editorCount(
      site(3, listing(3, { boundImage: true })),
      { cap: 500, media: {} }
    );
    expect(batched.byKind.image).toBe(1);
  });
});

describe("a list's image batch that cannot be used", () => {
  it("stops the reads ahead, so the images it fell back to keep their reads", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Each entry's own picture, then its author through a relation.
    const nextly = site(
      2,
      pageOf([
        postsList("list", 2, [
          {
            id: "cover",
            type: "core/image",
            version: 1,
            props: { alt: "" },
            bindings: { mediaId: { $bind: "featuredImage", source: "item" } },
          },
          itemHeading("author", "author.name", "No author"),
        ]),
      ]),
      // A batch read by `id in` whose count the route cannot trust.
      { distrustBatches: true }
    );
    // The entries, the batch it could not use, and each image's own read.
    const { html } = await journal(nextly, { maxQueries: 1 + 1 + 2 });
    expect(html).toContain("/media/1.jpg");
    expect(html).toContain("/media/2.jpg");
  });
});

describe("a list's reads ahead, in the order the list first draws its blocks", () => {
  it("reads the link the first entry draws before the relation only a later entry draws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const only = (title: string) => ({
      conditions: [[{ field: "title", op: "equals", value: title }]],
    });
    // The author, through a relation, comes first in the template, but only
    // the second entry draws it; the link comes later, and only the first
    // entry draws it. Ranked by place within each entry, the relation would
    // be read ahead first and leave the link short of its reads.
    const nextly = site(
      2,
      pageOf([
        postsList("list", 2, [
          {
            ...itemHeading("author", "author.name", "No author"),
            visibility: only("Post number 2"),
          },
          itemHeading("title", "title", "None"),
          {
            id: "more",
            type: "core/button",
            version: 1,
            props: { label: "Read", entryCollection: "posts" },
            bindings: { entryId: { $bind: "id", source: "item" } },
            visibility: only("Post number 1"),
          },
        ]),
      ])
    );
    // The entries, then exactly the link's own reads.
    const { html } = await journal(nextly, { maxQueries: 1 + 4 });
    expect(html).toContain('href="/post-1"');
  });
});

describe("a list's images, on a route that reads each by its own id", () => {
  it("stops the reads ahead at the images, so each keeps its own read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Each entry's own picture, then its author through a relation.
    const nextly = site(
      2,
      pageOf([
        postsList("list", 2, [
          {
            id: "cover",
            type: "core/image",
            version: 1,
            props: { alt: "" },
            bindings: { mediaId: { $bind: "featuredImage", source: "item" } },
          },
          itemHeading("author", "author.name", "No author"),
        ]),
      ])
    );
    const route = createPublicBlocksPage({
      collections: ["pages", "posts"],
      field: "content",
      blocks,
      mediaCollection: "images",
      // The site's own resolver, which takes one id.
      resolveMedia: (id: string) => Promise.resolve({ url: `/own/${id}.jpg` }),
      maxQueries: 1 + 2,
      nextly: nextly as never,
    });
    const element = await throughBoundary<{ children?: unknown }>(
      route.ContentPage({ params: { slug: ["journal"] } })
    );
    const html = await renderToHtml(element);
    // The entries, then each image's own read: the relation is not read
    // ahead of them.
    expect(html).toContain("/own/image-1.jpg");
    expect(html).toContain("/own/image-2.jpg");
  });
});

describe("a list's reads ahead, stopped where a step reads nothing ahead", () => {
  const linkThenAuthor = () =>
    pageOf([
      postsList("list", 1, [
        {
          id: "more",
          type: "core/button",
          version: 1,
          props: { label: "Read", entryCollection: "posts" },
          bindings: { entryId: { $bind: "id", source: "item" } },
        },
        // After the link on the page, through a relation.
        itemHeading("author", "author.name", "No author"),
      ]),
    ]);

  it("on a route with its own entry paths, the link keeps its read before the relation", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nextly = site(5, linkThenAuthor());
    const route = createPublicBlocksPage({
      collections: ["pages", "posts"],
      field: "content",
      blocks,
      mediaCollection: "images",
      // The site's own resolver, which takes one reference and reads none
      // ahead.
      resolveEntryPath: (_collection: string, id: string) =>
        Promise.resolve(`/own/${id}`),
      // The entries, then the link's one read.
      maxQueries: 1 + 1,
      nextly: nextly as never,
    });
    const element = await throughBoundary<{ children?: unknown }>(
      route.ContentPage({ params: { slug: ["journal"] } })
    );
    const html = await renderToHtml(element);
    expect(html).toContain('href="/own/post-1"');
    expect(html).toContain(">No author<");
  });

  it("in the editor's count, a link batch it cannot afford stops the reads ahead", async () => {
    // The entries, then exactly the link's own three reads: too few for its
    // batch, which keeps each link's reads after it.
    const counted = await editorCount(site(5, linkThenAuthor()), {
      cap: 1 + 3,
      media: {},
    });
    expect(counted.byKind).toEqual({ entries: 1, link: 3 });
    expect(counted.unread).toEqual([]);
  });
});

describe("a list's reads ahead, from what each block is drawn with", () => {
  it("reads no media ahead for an image drawn from an address, so a later block keeps its read", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    runtime.shapes.set("collection:posts", [
      { name: "title", type: "text" },
      { name: "slug", type: "text" },
      { name: "author", type: "relationship", relationTo: "authors" },
      { name: "coverUrl", type: "url" },
    ]);
    const nextly = site(
      1,
      pageOf([
        postsList("list", 1, [
          // Drawn from the address the entry's URL field holds: no read.
          {
            id: "cover",
            type: "core/image",
            version: 1,
            props: { alt: "" },
            bindings: { mediaId: { $bind: "coverUrl", source: "item" } },
          },
          itemHeading("author", "author.name", "No author"),
        ]),
      ])
    );
    for (const post of nextly.stored.posts ?? []) {
      post.coverUrl = `/pictures/${String(post.id)}.jpg`;
    }
    // The entries, then the author's relation.
    const { html } = await journal(nextly, { maxQueries: 1 + 1 });
    expect(html).toContain("/pictures/post-1.jpg");
    expect(html).toContain("Writer 1");
  });
});

describe("a list's link batch that cannot be used", () => {
  it("stops the reads ahead, so the link keeps the reads it was asked on", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nextly = site(
      1,
      pageOf([
        postsList("list", 1, [
          {
            id: "more",
            type: "core/button",
            version: 1,
            props: { label: "Read", entryCollection: "posts" },
            bindings: { entryId: { $bind: "id", source: "item" } },
          },
          itemHeading("author", "author.name", "No author"),
        ]),
      ]),
      // A batch read by `id in` whose count the route cannot trust.
      { distrustBatches: true }
    );
    const route = createPublicBlocksPage({
      collections: ["pages", "posts"],
      field: "content",
      blocks,
      mediaCollection: "images",
      // The entries, then exactly what a batch of one link is asked on: its
      // reads and one more link's after it.
      maxQueries: 1 + 8,
      nextly: nextly as never,
    });
    const element = await throughBoundary<{ children?: unknown }>(
      route.ContentPage({ params: { slug: ["journal"] } })
    );
    const html = await renderToHtml(element);
    expect(html).toContain('href="/post-1"');
    // The relation after it is not read ahead: the reads it would have
    // spent stay for the link as it is drawn.
    expect(reportIn(element)?.byKind.related).toBeUndefined();
  });
});

describe("two lists drawing one image", () => {
  const twoLists = () =>
    pageOf([
      postsList("list-a", 1, [
        {
          id: "cover-a",
          type: "core/image",
          version: 1,
          props: { alt: "", mediaId: "image-1" },
        },
      ]),
      postsList("list-b", 1, [
        {
          id: "cover-b",
          type: "core/image",
          version: 1,
          props: { alt: "", mediaId: "image-1" },
        },
        itemHeading("author-b", "author.name", "No author"),
      ]),
    ]);

  it("read it once, the second list waiting for the first one's batch", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nextly = site(1, twoLists());
    const route = createPublicBlocksPage({
      collections: ["pages", "posts"],
      field: "content",
      blocks,
      mediaCollection: "images",
      nextly: nextly as never,
    });
    const element = await throughBoundary<{ children?: unknown }>(
      route.ContentPage({ params: { slug: ["journal"] } })
    );
    const html = await renderToHtml(element);
    expect(html.split("/media/1.jpg").length - 1).toBe(2);
    expect(reportIn(element)?.byKind.image).toBe(1);
  });

  it("leave the second list its read for a later block under a tight allowance", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Both lists' entries, the one batch, and the second list's relation.
    const { html } = await journal(site(1, twoLists()), {
      maxQueries: 2 + 2,
    });
    expect(html.split("/media/1.jpg").length - 1).toBe(2);
    expect(html).toContain("Writer 1");
  });
});
