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
import { NextlyError } from "nextly/errors";
import {
  listPageNumber,
  listPageOf,
  type BindingSourceRef,
} from "nextly/runtime";
import { createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real reader, told the fake's declarations (it hides no field), since
// no Nextly services are registered in this process for it to read a schema
// from; and each cached read's tags and key, so what refreshes a page, and
// what it is cached under, is seen; and the waits for the request among the
// address lookups, in order.
const runtime = vi.hoisted(() => ({
  tags: [] as string[][],
  keys: [] as string[][],
  // When set, the route's design reads are answered from it by their key, as
  // Next's cache answers them, so a key that is not the entry's own is seen
  // serving one entry another's design.
  designCache: null as Map<string, Promise<unknown>> | null,
  events: [] as string[],
  // The address each page's head was asked for, as the runtime was told it.
  metadataPaths: [] as string[],
  // The address each page's structured data was asked for, and what the
  // runtime answers when set.
  structuredPaths: [] as string[],
  structuredData: undefined as string | undefined,
}));
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
      runtime.keys.push([...options.keyParts]);
      const cache = runtime.designCache;
      if (cache !== null && options.keyParts[0] === "nextly-content-design") {
        const key = JSON.stringify(options.keyParts);
        const cached = cache.get(key) ?? read();
        cache.set(key, cached);
        return cached;
      }
      return actual.cachedFind(read, options);
    },
    contentPageMetadata: (
      ...args: Parameters<typeof actual.contentPageMetadata>
    ) => {
      runtime.metadataPaths.push(args[3]);
      return actual.contentPageMetadata(...args);
    },
    contentPageStructuredData: async (
      ...args: Parameters<typeof actual.contentPageStructuredData>
    ) => {
      runtime.structuredPaths.push(args[3]);
      return (
        runtime.structuredData ?? actual.contentPageStructuredData(...args)
      );
    },
    readPublicSiteSettings: async () => {
      throw new Error("no site settings");
    },
    bindingFieldShapes: async (_ref: BindingSourceRef) => undefined,
    deferToRequest: async () => {
      runtime.events.push("request");
    },
    // A site in English and German whose rule prefixes every language, so
    // a `[locale]` request is told apart without a booted site. A route with
    // no segment is answered by the real helpers, which read nothing for it.
    requestLanguage: async (
      ...args: Parameters<typeof actual.requestLanguage>
    ) => {
      const [segment] = args;
      if (segment === undefined) return actual.requestLanguage(...args);
      return segment === "en" || segment === "de"
        ? { locale: segment, fromSegment: true }
        : null;
    },
    servedAddress: async (...args: Parameters<typeof actual.servedAddress>) => {
      const [path, language] = args;
      if (!language.fromSegment) return actual.servedAddress(...args);
      return `/${String(language.locale)}${path === "/" ? "" : path}`;
    },
  };
});

import { throughBoundary } from "./__tests__/through-boundary";
import { coreBlocks } from "./blocks";
import {
  createBlocksPage,
  createContentPage,
  createPublicBlocksPage,
  createPublicContentPage,
  createPublicSinglePage,
  createSinglePage,
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
    // A collection the public is refused outright, as the Direct API refuses.
    if (args.collection === "denied") throw new Error("forbidden");
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
      runtime.events.push(`lookup ${path}`);
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
  runtime.events = [];
  runtime.keys = [];
  runtime.designCache = null;
  runtime.metadataPaths = [];
  runtime.structuredPaths = [];
  runtime.structuredData = undefined;
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

  describe("an entry the public is refused", () => {
    /** The route's options over an instance whose read of posts fails with `error`. */
    function failing(error: () => unknown) {
      const options = config();
      const nextly = options.pages.nextly as unknown as ReturnType<
        typeof instance
      >;
      const read = nextly.find.getMockImplementation();
      nextly.find.mockImplementation(async (args: Record<string, unknown>) => {
        if (args.collection === "posts") throw error();
        return await read!(args);
      });
      return options;
    }

    it.each([
      [
        "an access-enforced route",
        "a visitor asked to sign in",
        createContentPage,
        () => NextlyError.authRequired(),
      ],
      [
        "a public route",
        "a visitor asked to sign in",
        createPublicContentPage,
        () => NextlyError.authRequired(),
      ],
      [
        "an access-enforced route",
        "a denial",
        createContentPage,
        () => NextlyError.forbidden(),
      ],
      [
        "a public route",
        "a denial",
        createPublicContentPage,
        () => NextlyError.forbidden(),
      ],
    ] as const)(
      "answers not found, as for an unpublished entry (%s, %s)",
      async (_route, _refusal, factory, refusal) => {
        const route = factory(failing(refusal));
        await expect(
          route.ContentPage({ params: { slug: ["blog", "hello"] } })
        ).rejects.toMatchObject(NOT_FOUND);
        // The head answers not found too, so a crawler gets a 404.
        await expect(
          route.generateMetadata({ params: { slug: ["blog", "hello"] } })
        ).rejects.toMatchObject(NOT_FOUND);
      }
    );

    it.each([
      ["a fault", () => new Error("database unreachable")],
      ["a credential to fix", () => NextlyError.tokenExpired()],
      ["a 403 that is not a denial", () => NextlyError.emailNotVerified()],
    ] as const)(
      "throws %s rather than answering not found",
      async (_why, error) => {
        const thrown = error();
        const route = createContentPage(failing(() => thrown));
        await expect(
          route.ContentPage({ params: { slug: ["blog", "hello"] } })
        ).rejects.toBe(thrown);
      }
    );
  });

  it("waits for the request before an access-enforced route's uncached lookup, and a public route's cached one does not", async () => {
    await createContentPage(config()).generateMetadata({
      params: { slug: ["blog", "hello"] },
    });
    expect(runtime.events.slice(0, 2)).toEqual([
      "request",
      "lookup /blog/hello",
    ]);

    runtime.events = [];
    await createPublicContentPage(config()).generateMetadata({
      params: { slug: ["blog", "hello"] },
    });
    expect(runtime.events).not.toContain("request");
    expect(runtime.events).toContain("lookup /blog/hello");
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
    // An address nothing holds: the head answers not found, as the page does.
    await expect(
      route.generateMetadata({ params: { slug: ["blog", "none"] } })
    ).rejects.toMatchObject(NOT_FOUND);
  });

  it("asks for an entry's head through the runtime, at the address it was served", async () => {
    // So a plugin that provides page metadata answers an entry served here
    // exactly as it answers a page the pages route serves.
    const route = createContentPage(config());
    await route.generateMetadata({ params: { slug: ["blog", "hello"] } });
    expect(runtime.metadataPaths).toEqual(["/blog/hello"]);
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
    // Nor to one in a collection the public is refused outright: the
    // refusal is no target, never an error a block must handle.
    expect(
      await element.props.context?.resolveEntryPath("denied", "d1")
    ).toBeNull();
    expect(asked).not.toContain("d1");
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

/**
 * An entry's own design: a template that serves one entry instead of its
 * collection. The literal heading it draws is what tells it from the
 * collection's template, whose heading is the entry's bound title.
 */
const OWN = headingDocument(
  "template",
  { props: { text: "Drawn with its own design", level: "h1" } },
  { title: [{ $bind: "title" }, " | Own"] }
);

/** The paths two posts hold: one with an own design, one without. */
const TWO_POSTS: Record<string, ContentAddressHolder> = {
  "/blog/hello": HELD["/blog/hello"],
  "/blog/other": { collection: "posts", id: "other", kind: "address" },
};

/**
 * A provider that answers `post-1` its own design and every other post its
 * collection's template, as the page builder's `readFor` does, recording
 * what it is asked.
 */
function withOwnDesigns() {
  const asked: [string, string, string | undefined][] = [];
  const base = config();
  const options: ContentPageConfig = {
    ...base,
    resolveAddress: async (_locale, path) => TWO_POSTS[path] ?? null,
    templates: {
      ...base.templates,
      readFor: async (collection, id, locale) => {
        asked.push([collection, id, locale]);
        if (collection !== "posts") return null;
        return id === "post-1"
          ? { id: "own-1", document: OWN }
          : { id: "t1", document: TEMPLATE };
      },
    },
  };
  return { asked, options };
}

describe("an entry's own design", () => {
  it.each([
    ["an access-enforced route", createContentPage],
    ["a public route", createPublicContentPage],
  ] as const)(
    "draws an entry with its own published design, and an entry without one with its collection's template (%s)",
    async (_name, factory) => {
      const { asked, options } = withOwnDesigns();
      const route = factory(options);
      const own = await served(route, ["blog", "hello"]);
      expect(own).toContain("Drawn with its own design");
      expect(own).not.toContain("Hello world");
      const other = await served(route, ["blog", "other"]);
      expect(other).toContain("Another post");
      expect(other).not.toContain("Drawn with its own design");
      expect(asked).toEqual([
        ["posts", "post-1", undefined],
        ["posts", "other", undefined],
      ]);
    }
  );

  it("takes an entry's metadata from its own design's SEO", async () => {
    const route = createContentPage(withOwnDesigns().options);
    expect(
      await route.generateMetadata({ params: { slug: ["blog", "hello"] } })
    ).toEqual({ title: "Hello world | Own" });
    expect(
      await route.generateMetadata({ params: { slug: ["blog", "other"] } })
    ).toEqual({ title: "Another post | Blog" });
  });

  it("asks only `readFor` once the provider offers it, so its null is not found whatever `read` answers", async () => {
    const read = vi.fn(async () => ({ id: "t1", document: TEMPLATE }));
    const base = withOwnDesigns().options;
    const route = createContentPage({
      ...base,
      templates: { ...base.templates, read, readFor: async () => null },
    });
    await expect(
      route.ContentPage({ params: { slug: ["blog", "hello"] } })
    ).rejects.toMatchObject(NOT_FOUND);
    expect(read).not.toHaveBeenCalled();
  });

  it("asks for the published design in the route's language, with no draft scope to ask for even where the route has a draft gate", async () => {
    const base = withOwnDesigns();
    const draft = vi.fn(async () => false);
    const route = createContentPage({
      ...base.options,
      pages: { ...base.options.pages, locale: "fr", draft },
    });
    await route
      .ContentPage({ params: { slug: ["blog", "hello"] } })
      .catch(() => undefined);
    expect(draft).toHaveBeenCalled();
    expect(base.asked).toEqual([["posts", "post-1", "fr"]]);
  });

  it("caches each entry's design under its own key, tagged with templates, so one entry is never served another's", async () => {
    runtime.designCache = new Map();
    const { asked, options } = withOwnDesigns();
    const route = createPublicContentPage(options);

    expect(await served(route, ["blog", "hello"])).toContain(
      "Drawn with its own design"
    );
    const other = await served(route, ["blog", "other"]);
    expect(other).toContain("Another post");
    expect(other).not.toContain("Drawn with its own design");
    // Served again from the cache: the cache is really answering, so the
    // separation above is the key's doing.
    expect(await served(route, ["blog", "hello"])).toContain(
      "Drawn with its own design"
    );
    expect(asked).toHaveLength(2);

    const designReads = runtime.keys.flatMap((key, at) =>
      key[0] === "nextly-content-design"
        ? [{ key, tags: runtime.tags[at] }]
        : []
    );
    expect(designReads.map(read => read.key.slice(-2))).toEqual([
      ["posts", "post-1"],
      ["posts", "other"],
      ["posts", "post-1"],
    ]);
    expect(designReads.map(read => read.tags)).toEqual([
      ["nextly:templates"],
      ["nextly:templates"],
      ["nextly:templates"],
    ]);
  });

  it("keeps the collection's template cache for a provider without `readFor`", async () => {
    await served(createPublicContentPage(config()), ["blog", "hello"]);
    expect(runtime.keys.map(key => key[0])).toContain(
      "nextly-content-template"
    );
    expect(runtime.keys.map(key => key[0])).not.toContain(
      "nextly-content-design"
    );
  });
});

describe("an entry's list split into pages", () => {
  /** A template of the entry's title over a list of posts, one a page. */
  const PAGED_TEMPLATE = JSON.parse(
    JSON.stringify({
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "template",
      nodes: [
        {
          id: "h",
          type: "core/heading",
          version: 1,
          props: { text: "Own", level: "h1" },
          bindings: { text: { $bind: "title", fallback: "No title" } },
        },
        {
          id: "list",
          type: "core/collection-loop",
          version: 1,
          props: { collection: "posts", limit: 1, paginate: true },
          slots: { children: [], empty: [] },
        },
      ],
    })
  ) as BlockDocument;

  /** post-1's list's later pages, held as one space, as the store gives them. */
  const SPACE: ContentAddressHolder = {
    collection: "posts",
    id: "post-1",
    kind: "space",
  };

  /**
   * The route over a store that gives post-1 its address, and its list's
   * later pages to `laterPages` (post-1 itself by default), and a Direct API
   * whose list of posts matches three, so the list has three pages.
   *
   * The store answers as the real one does: a later page is one the route
   * reads as a page number from 2, so `page/1`, `page/02` and `page/two` are
   * held by no one; and a document published at `page/2` (the default
   * blocks none) holds that address alone, the space's other pages then
   * held by no one, since the entry waits for its space.
   */
  function pagedConfig(
    design: BlockDocument = PAGED_TEMPLATE,
    blocking?: ContentAddressHolder
  ) {
    const options = config({
      resolveAddress: async (_locale, path) => {
        if (path === "/blog/hello") return HELD["/blog/hello"];
        const later = listPageOf(path.slice(1));
        const page = later === null ? null : listPageNumber(later.segment);
        if (later?.base !== "blog/hello" || page === null || page < 2) {
          return null;
        }
        if (blocking === undefined) return SPACE;
        return page === 2 ? blocking : null;
      },
      templates: {
        collection: "templates",
        read: async collection =>
          collection === "posts" ? { id: "t1", document: design } : null,
      },
    });
    const nextly = options.pages.nextly as unknown as ReturnType<
      typeof instance
    >;
    const read = nextly.find.getMockImplementation();
    nextly.find.mockImplementation(async (args: Record<string, unknown>) => {
      const byId = JSON.stringify(args.where ?? {}).includes('"id"');
      if (args.collection === "posts" && isPublicRead(args) && !byId) {
        const items = ["a", "b", "c"].map(id => ({ id, title: `Post ${id}` }));
        return { items, meta: { total: items.length, hasNext: true } };
      }
      return await read!(args);
    });
    return options;
  }

  it.each([
    ["an access-enforced route", createContentPage],
    ["a public route", createPublicContentPage],
  ] as const)(
    "serves a later page of the list on an entry's page, drawn with the design serving it (%s)",
    async (_name, factory) => {
      const route = factory(pagedConfig());
      const html = await served(route, ["blog", "hello", "page", "2"]);
      expect(html).toContain("Hello world");
      // The list's links name the entry's own address and its later pages.
      expect(html).toContain('href="/blog/hello/page/3"');
      expect(html).toContain('href="/blog/hello"');
      // Its metadata is the entry's, where a path no one serves has none.
      expect(
        await route.generateMetadata({
          params: { slug: ["blog", "hello", "page", "2"] },
        })
      ).toHaveProperty("title");
    }
  );

  it("links the entry's own page to its list's later pages", async () => {
    const html = await served(createContentPage(pagedConfig()), [
      "blog",
      "hello",
    ]);
    expect(html).toContain('href="/blog/hello/page/2"');
  });

  it("redirects the first page to the entry's address in the language a [locale] segment names", async () => {
    const route = createContentPage(pagedConfig());
    await expect(
      route.ContentPage({
        params: { locale: "de", slug: ["blog", "hello", "page", "1"] },
      })
    ).rejects.toMatchObject({
      digest: expect.stringContaining(";/de/blog/hello;308;"),
    });
  });

  it("redirects the list's first page under a second spelling to the entry's own address", async () => {
    const route = createContentPage(pagedConfig());
    await expect(
      route.ContentPage({ params: { slug: ["blog", "hello", "page", "1"] } })
    ).rejects.toMatchObject({
      digest: expect.stringContaining(";/blog/hello;308;"),
    });
  });

  it.each([
    ["a page past the list's last", ["blog", "hello", "page", "4"]],
    ["a page number written another way", ["blog", "hello", "page", "02"]],
    ["no page number at all", ["blog", "hello", "page", "two"]],
  ])("answers not found for %s", async (_why, slug) => {
    const route = createContentPage(pagedConfig());
    await expect(route.ContentPage({ params: { slug } })).rejects.toMatchObject(
      NOT_FOUND
    );
  });

  describe("while a page is published among its later pages", () => {
    const BLOCKING: ContentAddressHolder = {
      collection: "pages",
      id: "p2",
      kind: "address",
    };

    it("draws the entry's list unpaged, linking to none of its later pages", async () => {
      const html = await served(
        createContentPage(pagedConfig(PAGED_TEMPLATE, BLOCKING)),
        ["blog", "hello"]
      );
      expect(html).toContain("Hello world");
      expect(html).not.toContain("/blog/hello/page/");
    });

    it.each([
      ["a later page the space would hold", ["blog", "hello", "page", "3"]],
      [
        "the first page under a second spelling",
        ["blog", "hello", "page", "1"],
      ],
    ])("answers not found for %s", async (_why, slug) => {
      const route = createContentPage(pagedConfig(PAGED_TEMPLATE, BLOCKING));
      await expect(
        route.ContentPage({ params: { slug } })
      ).rejects.toMatchObject(NOT_FOUND);
    });
  });

  it("answers not found for a later page where the design serving the entry splits no list", async () => {
    const route = createContentPage(pagedConfig(TEMPLATE));
    await expect(
      route.ContentPage({ params: { slug: ["blog", "hello", "page", "2"] } })
    ).rejects.toMatchObject(NOT_FOUND);
  });
});

describe("under a [locale] segment", () => {
  it("asks the store, and reads the entry, in the language the segment names", async () => {
    const options = config();
    const route = createContentPage(options);
    const element = await throughBoundary<PageRendererProps>(
      route.ContentPage({ params: { locale: "de", slug: ["blog", "hello"] } })
    );
    const html = await renderToHtml(createElement(PageRenderer, element.props));

    expect(html).toContain("Hello world");
    // Its address, then whether it holds its list's later pages: each in
    // German.
    expect(options.lookups[0]).toEqual(["de", "/blog/hello"]);
    expect(options.lookups.every(([locale]) => locale === "de")).toBe(true);
    const nextly = options.pages.nextly as unknown as ReturnType<
      typeof instance
    >;
    const entryReads = nextly.find.mock.calls
      .map(([args]) => args)
      .filter(args => args.collection === "posts");
    expect(entryReads.length).toBeGreaterThan(0);
    expect(entryReads.every(args => args.locale === "de")).toBe(true);
  });

  it("reads the images an entry's design draws in the language the segment names", async () => {
    const IMAGE = "66666666-6666-4666-8666-666666666666";
    const withImage = JSON.parse(
      JSON.stringify({
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "template",
        nodes: [
          {
            id: "i",
            type: "core/image",
            version: 1,
            props: { mediaId: IMAGE },
          },
        ],
      })
    ) as BlockDocument;
    const options = config({
      templates: {
        collection: "templates",
        read: async collection =>
          collection === "posts" ? { id: "t1", document: withImage } : null,
      },
    });
    const route = createContentPage({
      ...options,
      pages: { ...options.pages, mediaCollection: "photos" },
    });

    const element = await throughBoundary<PageRendererProps>(
      route.ContentPage({ params: { locale: "de", slug: ["blog", "hello"] } })
    );
    await renderToHtml(createElement(PageRenderer, element.props));

    const nextly = options.pages.nextly as unknown as ReturnType<
      typeof instance
    >;
    const imageReads = nextly.find.mock.calls
      .map(([args]) => args)
      .filter(args => args.collection === "photos");
    expect(imageReads.length).toBeGreaterThan(0);
    expect(imageReads.every(args => args.locale === "de")).toBe(true);
  });

  it("answers not found for a segment naming none of the site's languages, asking nothing", async () => {
    const options = config();
    await expect(
      createContentPage(options).ContentPage({
        params: { locale: "xx", slug: ["blog", "hello"] },
      })
    ).rejects.toMatchObject(NOT_FOUND);
    expect(options.lookups).toEqual([]);
  });

  it("links to an entry at its address in the language the segment names, read in it", async () => {
    const asked: [string, string | undefined][] = [];
    const route = createContentPage(
      config({
        entryPath: async (collection, id, locale) => {
          asked.push([id, locale]);
          return collection === "posts" ? `/blog/${id}` : null;
        },
      })
    );
    const element = await throughBoundary<PageRendererProps>(
      route.ContentPage({ params: { locale: "de", slug: ["blog", "hello"] } })
    );
    expect(
      await element.props.context?.resolveEntryPath("posts", "other")
    ).toBe("/de/blog/other");
    expect(asked).toEqual([["other", "de"]]);
  });

  it("places an entry's structured data in its HTML, asked at its address in the language", async () => {
    runtime.structuredData = '{"@type":"BlogPosting","headline":"Hello world"}';
    const element = await throughBoundary(
      createContentPage(config()).ContentPage({
        params: { locale: "de", slug: ["blog", "hello"] },
      })
    );
    const html = await renderToHtml(element);

    expect(runtime.structuredPaths).toEqual(["/de/blog/hello"]);
    expect(html).toContain(
      '<script type="application/ld+json">{"@type":"BlogPosting","headline":"Hello world"}</script>'
    );
    expect(html).toContain("Hello world");
  });

  it("asks for an entry's head at its address in the language", async () => {
    await createContentPage(config()).generateMetadata({
      params: { locale: "de", slug: ["blog", "hello"] },
    });
    expect(runtime.metadataPaths).toEqual(["/de/blog/hello"]);
  });

  it("pre-renders the addresses the store holds in the language the layout hands it", async () => {
    const asked: (string | undefined)[] = [];
    const route = createPublicContentPage(
      config({
        addresses: async locale => {
          asked.push(locale);
          return [];
        },
      })
    );
    await route.generateStaticParams({ params: { locale: "de" } });
    expect(asked).toEqual(["de"]);
  });
});

describe("a site's own not-found handler", () => {
  /** A handler that throws its own error, counting its calls. */
  function handler(): { notFound: () => never; calls: () => number } {
    let calls = 0;
    return {
      notFound: () => {
        calls += 1;
        throw new Error("site: not found");
      },
      calls: () => calls,
    };
  }

  const missing = { params: { slug: ["blog", "none"] } };

  it.each([
    ["an access-enforced route", createContentPage],
    ["a public route", createPublicContentPage],
  ] as const)(
    "is not needed: without one a miss is Next's notFound() (%s)",
    async (_name, factory) => {
      const route = factory(config());
      await expect(route.ContentPage(missing)).rejects.toMatchObject(NOT_FOUND);
      await expect(route.generateMetadata(missing)).rejects.toMatchObject(
        NOT_FOUND
      );
    }
  );

  it("answers a miss for the page and its head alike", async () => {
    const site = handler();
    const route = createContentPage(config({ notFound: site.notFound }));
    await expect(route.ContentPage(missing)).rejects.toThrow("site: not found");
    await expect(route.generateMetadata(missing)).rejects.toThrow(
      "site: not found"
    );
    expect(site.calls()).toBe(2);
  });

  it("answers a public route's miss under Cache Components, where the route answers it per request", async () => {
    vi.stubEnv("__NEXT_CACHE_COMPONENTS", "true");
    try {
      const site = handler();
      const route = createPublicContentPage(
        config({ notFound: site.notFound })
      );
      await expect(throughBoundary(route.ContentPage(missing))).rejects.toThrow(
        "site: not found"
      );
      await expect(route.generateMetadata(missing)).rejects.toThrow(
        "site: not found"
      );
      expect(site.calls()).toBe(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("leaves a public route's miss to Next's notFound() without Cache Components, where the answer is kept", async () => {
    // Rendered once and kept, a render that read the request would be
    // refused at runtime, so the handler, which may read it, is not called.
    vi.stubEnv("__NEXT_CACHE_COMPONENTS", "false");
    try {
      const site = handler();
      const route = createPublicContentPage(
        config({ notFound: site.notFound })
      );
      await expect(route.ContentPage(missing)).rejects.toMatchObject(NOT_FOUND);
      await expect(route.generateMetadata(missing)).rejects.toMatchObject(
        NOT_FOUND
      );
      expect(site.calls()).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("answers a miss the pages route decides, given on the route or on its pages", async () => {
    // A path the runtime keeps is refused by the pages route itself.
    const onRoute = handler();
    await expect(
      createContentPage(config({ notFound: onRoute.notFound })).ContentPage({
        params: { slug: ["admin"] },
      })
    ).rejects.toThrow("site: not found");
    expect(onRoute.calls()).toBe(1);

    const onPages = handler();
    const options = config();
    await expect(
      createContentPage({
        ...options,
        pages: { ...options.pages, notFound: onPages.notFound },
      }).ContentPage(missing)
    ).rejects.toThrow("site: not found");
    expect(onPages.calls()).toBe(1);
  });

  it("is still followed by Next's notFound() when it returns", async () => {
    let calls = 0;
    const route = createContentPage(
      config({
        notFound: async () => {
          calls += 1;
          return undefined as never;
        },
      })
    );
    await expect(route.ContentPage(missing)).rejects.toMatchObject(NOT_FOUND);
    expect(calls).toBe(1);
  });

  it("is never called for a path the route serves", async () => {
    const site = handler();
    const route = createContentPage(config({ notFound: site.notFound }));
    await served(route, ["blog", "hello"]);
    await route.generateMetadata({ params: { slug: ["blog", "hello"] } });
    expect(site.calls()).toBe(0);
  });

  it("answers a blocks page's and a Single page's misses too", async () => {
    const pages = handler();
    await expect(
      createBlocksPage({
        ...config().pages,
        notFound: pages.notFound,
      }).ContentPage({ params: { slug: ["admin"] } })
    ).rejects.toThrow("site: not found");
    expect(pages.calls()).toBe(1);

    const single = handler();
    await expect(
      createSinglePage({
        slug: "home",
        field: "content",
        blocks,
        nextly: instance(POSTS) as never,
        notFound: single.notFound,
      }).SinglePage()
    ).rejects.toThrow("site: not found");
    expect(single.calls()).toBe(1);

    // The public forms keep their answers without Cache Components.
    vi.stubEnv("__NEXT_CACHE_COMPONENTS", "false");
    try {
      const kept = handler();
      await expect(
        createPublicBlocksPage({
          ...config().pages,
          notFound: kept.notFound,
        }).ContentPage({ params: { slug: ["admin"] } })
      ).rejects.toMatchObject(NOT_FOUND);
      await expect(
        createPublicSinglePage({
          slug: "home",
          field: "content",
          blocks,
          nextly: instance(POSTS) as never,
          notFound: kept.notFound,
        }).SinglePage()
      ).rejects.toMatchObject(NOT_FOUND);
      expect(kept.calls()).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
