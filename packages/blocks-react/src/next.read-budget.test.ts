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
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { BindingSourceRef } from "nextly/runtime";
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
import { createPublicBlocksPage } from "./next";
import type { PageRendererProps } from "./page-renderer";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

const blocks = createBlockResolver(coreBlocks);

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
        default:
          throw new Error(`The fake has no operator "${op}".`);
      }
    });
  });
}

/** A site of `count` posts, each with an author, an image and a page. */
function site(count: number, document: BlockDocument) {
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
    const select = args.select as Record<string, boolean> | undefined;
    const items = all
      .slice(0, limit)
      .map(row =>
        select === undefined
          ? row
          : Object.fromEntries(
              Object.entries(row).filter(([key]) => select[key] === true)
            )
      );
    return { items, meta: { total: all.length } };
  });
  const findByID = vi.fn(async () => null);
  const mediaById = vi.fn(async () => null);
  const publicSiteSettings = vi.fn(async () => ({
    siteName: "Journal",
    timezone: "UTC",
  }));
  return {
    find,
    findByID,
    publicSiteSettings,
    media: { findByID: mediaById },
    stored,
  };
}

/** Every read the fake answered, of any kind, so far. */
function readsSoFar(nextly: Site): number {
  return (
    nextly.find.mock.calls.length +
    nextly.findByID.mock.calls.length +
    nextly.publicSiteSettings.mock.calls.length +
    nextly.media.findByID.mock.calls.length
  );
}

/** A page of one list of posts: a title, an author's name, an image, a link. */
function listing(limit: number): BlockDocument {
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
          props: { collection: "posts", limit },
          slots: {
            children: [
              itemText("title", "title"),
              itemText("author", "author.name"),
              // One picture for every entry: a bound image is filled only
              // once it carries its whole media object, which main does not
              // do yet, so the template's image is set, read once.
              {
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
                bindings: { entryId: { $bind: "id", source: "item" } },
              },
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
  config: { maxQueries?: number } = {}
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
    /** Draw without the lists' read-ahead, as each entry read one by one. */
    oneByOne?: boolean;
  }
): Promise<{ html: string; reads: Row[]; total: number }> {
  const { slug, oneByOne, ...route } = config;
  const page = createPublicBlocksPage({
    blocks,
    mediaCollection: "images",
    ...route,
    nextly: nextly as never,
  });
  // The route resolving the page reads before the render's reads; the
  // bindings' sources and the blocks read after it, under the allowance.
  const resolved = readsSoFar(nextly);
  const before = nextly.find.mock.calls.length;
  const element = await throughBoundary<PageRendererProps>(
    page.ContentPage({ params: { slug: [slug] } })
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
    // The list's entries; its authors by id; its links: their rows by id,
    // then the three ownership checks as counts over all of them (the pair
    // stored, no lower id, no earlier collection); then its one image.
    expect(described(reads)).toEqual([
      "posts: query",
      "authors: by ids",
      "posts: by ids",
      "posts: count of pairs",
      "posts: count of pairs",
      "pages: by slugs",
      "images: query",
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
    // The entries and their authors, then nothing: the links are refused
    // ahead and again as each block asks, and the image as each asks.
    const { html, reads } = await journal(nextly, { maxQueries: 2 });
    expect(html).toContain("Post number 50");
    expect(html).toContain("Writer 1");
    expect(html).not.toContain("/media/");
    expect(html).not.toContain('href="/post-');
    expect(described(reads)).toEqual(["posts: query", "authors: by ids"]);
    await quiet();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[blocks] "pages" page "journal" needed more than its 2 reads: at least 101 read(s) refused; 3 block(s) drawn as if their data were missing: posts, picture, more.'
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
