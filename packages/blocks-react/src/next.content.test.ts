/**
 * The one content route: a path the address store says a page holds is
 * served as the pages route serves it; a path a collection's entry holds is
 * drawn with the collection's published template, the entry as its bindings'
 * source, read as the public reads it; anything else answers not found.
 *
 * Driven through the real route and the real reader, with only the Direct
 * API and the address store below them faked, so what is asserted is what a
 * visitor is served and what the route asks for.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type { BindingSourceRef } from "nextly/runtime";
import { createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real reader, told the fake's declarations (it hides no field), since
// no Nextly services are registered in this process for it to read a schema
// from; and each cached read's tags, so what refreshes a page is seen.
const runtime = vi.hoisted(() => ({ tags: [] as string[][] }));
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
    cachedFind: (
      read: () => Promise<unknown>,
      options: Parameters<typeof actual.cachedFind>[1]
    ) => {
      runtime.tags.push([...options.tags]);
      return actual.cachedFind(read, options);
    },
    readPublicSiteSettings: async () => {
      throw new Error("no site settings");
    },
    bindingFieldShapes: async (_ref: BindingSourceRef) => undefined,
  };
});

import { throughBoundary } from "./__tests__/through-boundary";
import { coreBlocks } from "./blocks";
import {
  createContentPage,
  createPublicContentPage,
  type ContentAddressHolder,
  type ContentPageConfig,
} from "./next";
import type { PageRendererProps } from "./page-renderer";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

const blocks = createBlockResolver(coreBlocks);

/** What Next.js's `notFound()` throws, for the App Router to answer 404. */
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return await new Response(stream).text();
}

/** A document of one heading: literal text, or bound to the entry. */
function headingDocument(
  kind: "page" | "template",
  heading: Record<string, unknown>,
  seo?: Record<string, unknown>
): BlockDocument {
  return JSON.parse(
    JSON.stringify({
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind,
      nodes: [
        {
          id: "h",
          type: "core/heading",
          version: 1,
          props: { text: "Own", level: "h1" },
          ...heading,
        },
      ],
      ...(seo === undefined ? {} : { settings: { seo } }),
    })
  ) as BlockDocument;
}

const PAGE = headingDocument("page", {
  props: { text: "The about page", level: "h1" },
});
const TEMPLATE = headingDocument(
  "template",
  { bindings: { text: { $bind: "title", fallback: "No title" } } },
  { title: [{ $bind: "title" }, " | Blog"] }
);

/** Whether a Direct API read is the public reader's: its fixed options. */
function isPublicRead(args: Record<string, unknown>): boolean {
  return (
    args.status === "published" &&
    args.overrideAccess === false &&
    args.unknownSort === "refuse"
  );
}

/** A Direct API over one page, `about`, and the posts the public may read. */
function instance(posts: Record<string, Record<string, unknown>>) {
  const find = vi.fn(async (args: Record<string, unknown>) => {
    const where = JSON.stringify(args.where ?? {});
    let items: Record<string, unknown>[] = [];
    if (args.collection === "pages") {
      items = isPublicRead(args)
        ? [{ id: "p1", title: "About" }]
        : [{ id: "p1", slug: "about", title: "About", content: PAGE }];
    } else if (args.collection === "posts" && isPublicRead(args)) {
      items = Object.values(posts).filter(post =>
        where.includes(JSON.stringify(post.id))
      );
    }
    return { items, meta: { total: items.length, hasNext: false } };
  });
  return {
    find,
    findByID: vi.fn(async () => null),
    findSingle: vi.fn(async () => null),
    media: { findByID: vi.fn(async () => null) },
  };
}

/** An address store holding `held`, recording every lookup. */
function store(held: Record<string, ContentAddressHolder>) {
  const lookups: [string | undefined, string][] = [];
  return {
    lookups,
    resolveAddress: async (locale: string | undefined, path: string) => {
      lookups.push([locale, path]);
      return held[path] ?? null;
    },
  };
}

const HELD = {
  "/about": { collection: "pages", id: "p1", kind: "address" as const },
  "/blog/hello": {
    collection: "posts",
    id: "post-1",
    kind: "address" as const,
  },
  "/blog/hidden": {
    collection: "posts",
    id: "post-2",
    kind: "address" as const,
  },
  "/news/x": { collection: "news", id: "n1", kind: "address" as const },
};

const POSTS = {
  "post-1": { id: "post-1", title: "Hello world" },
  other: { id: "other", title: "Another post" },
};

function config(
  overrides: Partial<ContentPageConfig> = {},
  posts: Record<string, Record<string, unknown>> = POSTS
): ContentPageConfig & { lookups: [string | undefined, string][] } {
  const addresses = store(HELD);
  return {
    lookups: addresses.lookups,
    pages: {
      collections: ["pages"],
      field: "content",
      blocks,
      nextly: instance(posts) as never,
      metadata: (_entry, _context, derived) => ({ title: derived.title }),
    },
    resolveAddress: addresses.resolveAddress,
    templates: {
      collection: "templates",
      read: async collection =>
        collection === "posts" ? { id: "t1", document: TEMPLATE } : null,
    },
    ...overrides,
  };
}

async function served(
  route: ReturnType<typeof createContentPage>,
  slug: string[]
): Promise<string> {
  const element = await throughBoundary<PageRendererProps>(
    route.ContentPage({ params: { slug } })
  );
  return await renderToHtml(createElement(PageRenderer, element.props));
}

beforeEach(() => {
  runtime.tags = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the content route", () => {
  it.each([
    ["an access-enforced route", createContentPage],
    ["a public route", createPublicContentPage],
  ] as const)(
    "serves a path a page holds as the page (%s)",
    async (_name, factory) => {
      const options = config();
      const html = await served(factory(options), ["about"]);
      expect(html).toContain("The about page");
      expect(options.lookups).toEqual([[undefined, "/about"]]);
    }
  );

  it.each([
    ["an access-enforced route", createContentPage],
    ["a public route", createPublicContentPage],
  ] as const)(
    "draws a path an entry holds with its collection's template, the entry as its binding source (%s)",
    async (_name, factory) => {
      const html = await served(factory(config()), ["blog", "hello"]);
      expect(html).toContain("Hello world");
      expect(html).not.toContain("No title");
      expect(html).not.toContain("The about page");
    }
  );

  it("reads the entry as the public does, published only", async () => {
    const options = config();
    const nextly = options.pages.nextly as unknown as ReturnType<
      typeof instance
    >;
    await served(createContentPage(options), ["blog", "hello"]);
    const postReads = nextly.find.mock.calls
      .map(([args]) => args)
      .filter(args => args.collection === "posts");
    expect(postReads.length).toBeGreaterThan(0);
    expect(postReads.every(args => isPublicRead(args))).toBe(true);
  });

  it("tags an entry's page with its collection and the templates, so either's write refreshes it", async () => {
    await served(createContentPage(config()), ["blog", "hello"]);
    const tags = runtime.tags.flat();
    expect(tags).toContain("nextly:templates");
    expect(tags).toContain("nextly:posts");
  });

  it.each([
    ["nothing holds the path", ["blog", "none"]],
    ["the entry's collection has no published template", ["news", "x"]],
    ["the public may not read the entry", ["blog", "hidden"]],
    ["the path is one the runtime keeps", ["admin"]],
  ])("answers not found when %s", async (_why, slug) => {
    const route = createContentPage(config());
    await expect(route.ContentPage({ params: { slug } })).rejects.toMatchObject(
      NOT_FOUND
    );
  });

  it("never asks the store about a path the runtime keeps", async () => {
    const options = config();
    await createContentPage(options)
      .ContentPage({ params: { slug: ["admin"] } })
      .catch(() => undefined);
    expect(options.lookups).toEqual([]);
  });

  it("takes an entry's metadata from its template's own SEO, bound to the entry", async () => {
    const route = createContentPage(config());
    expect(
      await route.generateMetadata({ params: { slug: ["blog", "hello"] } })
    ).toEqual({ title: "Hello world | Blog" });
    expect(
      await route.generateMetadata({ params: { slug: ["blog", "none"] } })
    ).toEqual({});
  });

  it("serves a page's draft where the pages route's gate grants it, since a draft holds no address", async () => {
    const draft = vi.fn(async () => true);
    const options = config();
    const route = createContentPage({
      ...options,
      pages: { ...options.pages, draft },
      resolveAddress: async () => null,
    });
    expect(await served(route, ["about"])).toContain("The about page");
    expect(draft).toHaveBeenCalled();
  });

  it("serves a page's draft over an entry holding its address, where the gate grants it", async () => {
    const options = config();
    const route = createContentPage({
      ...options,
      pages: { ...options.pages, draft: async () => true },
      resolveAddress: async () => HELD["/blog/hello"],
    });
    const html = await served(route, ["about"]);
    expect(html).toContain("The about page");
    expect(html).not.toContain("Hello world");
  });

  it("serves the entry where the gate grants nothing", async () => {
    const options = config();
    const route = createContentPage({
      ...options,
      pages: { ...options.pages, draft: async () => false },
    });
    expect(await served(route, ["blog", "hello"])).toContain("Hello world");
  });

  it("links to a page or an entry at the address the store says it is served at", async () => {
    const asked: [string, string, string | undefined][] = [];
    const route = createContentPage(
      config({
        entryPath: async (collection, id, locale) => {
          asked.push([collection, id, locale]);
          return collection === "posts" ? `/blog/${id}` : null;
        },
      })
    );
    for (const slug of [["blog", "hello"], ["about"]]) {
      const element = await throughBoundary<PageRendererProps>(
        route.ContentPage({ params: { slug } })
      );
      expect(
        await element.props.context?.resolveEntryPath("posts", "other")
      ).toBe("/blog/other");
      expect(
        await element.props.context?.resolveEntryPath("news", "n1")
      ).toBeNull();
    }
    expect(asked).toContainEqual(["posts", "other", undefined]);
  });

  it("draws no link to an entry the public may not read, and never asks the store for its address", async () => {
    const asked: string[] = [];
    const route = createContentPage(
      config({
        // The store holds an address for it: it is published, but its
        // collection's read access keeps it from visitors.
        entryPath: async (_collection, id) => {
          asked.push(id);
          return `/blog/${id}`;
        },
      })
    );
    const element = await throughBoundary<PageRendererProps>(
      route.ContentPage({ params: { slug: ["blog", "hello"] } })
    );
    expect(
      await element.props.context?.resolveEntryPath("posts", "restricted")
    ).toBeNull();
    expect(asked).not.toContain("restricted");
    // A public entry beside it still gets its address.
    expect(
      await element.props.context?.resolveEntryPath("posts", "other")
    ).toBe("/blog/other");
  });

  it("looks up a path under a mount by the whole path, so only the runtime's own paths are refused", async () => {
    const options = config();
    await createContentPage({
      ...options,
      pages: { ...options.pages, mountPath: "/site" },
    })
      .ContentPage({ params: { slug: ["admin"] } })
      .catch(() => undefined);
    expect(options.lookups).toEqual([[undefined, "/site/admin"]]);
  });

  it("asks the store for the path under the route's mount, in the route's language", async () => {
    const options = config();
    await createContentPage({
      ...options,
      pages: { ...options.pages, mountPath: "/site", locale: "fr" },
    })
      .ContentPage({ params: { slug: ["blog", "café"] } })
      .catch(() => undefined);
    expect(options.lookups).toEqual([["fr", "/site/blog/caf%C3%A9"]]);
  });

  it("pre-renders the addresses the store holds under the route's mount, asking for those alone", async () => {
    const asked: (readonly string[])[] = [];
    const route = createPublicContentPage(
      config({
        pages: { ...config().pages, mountPath: "/site" },
        addresses: async (_locale, _limit, under) => {
          asked.push(under);
          // The page's own params come from the pages route, as its lists'
          // later pages do, which the store holds as one space each.
          return [
            ["site", "blog", "hello"],
            ["site", "about"],
            ["elsewhere", "x"],
          ];
        },
      })
    );
    // The page first, from the pages route, then the entry, each once.
    expect(await route.generateStaticParams()).toEqual([
      { slug: ["about"] },
      { slug: ["blog", "hello"] },
    ]);
    expect(asked).toEqual([["site"]]);
  });

  it("caches a public route's links under every collection whose writes move an address", async () => {
    const route = createPublicContentPage(
      config({
        entryPath: async (_collection, id) => `/blog/${id}`,
        addressCollections: async () => ["pages", "templates", "posts"],
      })
    );
    const element = await throughBoundary<PageRendererProps>(
      route.ContentPage({ params: { slug: ["blog", "hello"] } })
    );
    runtime.tags = [];
    expect(
      await element.props.context?.resolveEntryPath("posts", "other")
    ).toBe("/blog/other");
    // A template's unpublish or a page's handover moves the target's address
    // with no write to the target's own collection.
    expect(runtime.tags).toContainEqual([
      "nextly:pages",
      "nextly:templates",
      "nextly:posts",
    ]);
  });
});
