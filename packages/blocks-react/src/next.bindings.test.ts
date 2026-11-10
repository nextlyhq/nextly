/**
 * What a routed page's bindings read: the entry again, through the route's
 * public reader, never the row the route resolved, which a public route reads
 * with trusted access and a preview reads as its draft.
 *
 * Driven through the real route and the real reader, with only the Direct
 * API below them faked, so what is asserted is what reaches the database
 * layer and what a visitor is served.
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  defineNamedQuery,
  DOCUMENT_FORMAT_VERSION,
  type BindingFieldShape,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import type {
  BindingFieldShape as NextlyBindingFieldShape,
  BindingSourceRef,
  PublicSiteSettings,
  PublicSiteSettingsSource,
  PublicSourceReader,
} from "nextly/runtime";
import { createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

// What the faked process answers for the public sources a page binds, and
// what each cached read was tagged with. The real reader is used, told the
// fake's declarations (it hides no field), since no Nextly services are
// registered in this process for it to read a schema from.
const runtime = vi.hoisted(() => ({
  site: null as PublicSiteSettings | null,
  /** How often the process's registered instance was read for the site settings. */
  processSiteReads: 0,
  shapes: new Map<string, unknown>(),
  tags: [] as string[][],
  /** Each cached read's key parts, beside its tags. */
  reads: [] as { keyParts: string[]; tags: string[] }[],
  pipelineRuns: 0,
  // Each judgement of what the public may see (a source's hidden fields, its
  // field shapes), and those made outside every cached read.
  judged: [] as string[],
  uncached: [] as string[],
  /** Whether the caller runs inside a cached read. */
  isCached: (): boolean => false,
}));
vi.mock("nextly/runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("nextly/runtime")>();
  const { AsyncLocalStorage } = await import("node:async_hooks");
  const inCache = new AsyncLocalStorage<true>();
  runtime.isCached = () => inCache.getStore() === true;
  const judged = (what: string) => {
    runtime.judged.push(what);
    if (inCache.getStore() !== true) runtime.uncached.push(what);
  };
  return {
    ...actual,
    createPublicReader: (
      ...[source, binding]: Parameters<typeof actual.createPublicReader>
    ) =>
      actual.createPublicReader(source, {
        ...binding,
        declarations: {
          hiddenFields: (hidden: { kind: string; slug: string }) => {
            judged(`hidden ${hidden.kind}:${hidden.slug}`);
            return [];
          },
        },
      }),
    cachedFind: (
      read: () => Promise<unknown>,
      options: Parameters<typeof actual.cachedFind>[1]
    ) => {
      runtime.tags.push([...options.tags]);
      runtime.reads.push({
        keyParts: [...options.keyParts],
        tags: [...options.tags],
      });
      return actual.cachedFind(() => inCache.run(true, read), options);
    },
    // The real read when given an instance, so the allowlist judges what the
    // instance answers; a read given none reaches for the process's
    // registered instance, which is counted and answers with `runtime.site`.
    readPublicSiteSettings: async (source?: PublicSiteSettingsSource) => {
      if (source !== undefined) {
        return await actual.readPublicSiteSettings(source);
      }
      runtime.processSiteReads += 1;
      if (runtime.site === null) throw new Error("no site settings");
      return runtime.site;
    },
    bindingFieldShapes: async (ref: BindingSourceRef) => {
      const key =
        "collection" in ref
          ? `collection:${ref.collection}`
          : `single:${ref.single}`;
      judged(`shapes ${key}`);
      return runtime.shapes.get(key);
    },
  };
});
// The read pipeline's migration pass, counted: it runs once per prepared
// document and nowhere else, so the count says how many times a page was
// prepared.
vi.mock("@nextlyhq/blocks-engine", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@nextlyhq/blocks-engine")>();
  return {
    ...actual,
    migrateDocument: (...args: Parameters<typeof actual.migrateDocument>) => {
      runtime.pipelineRuns += 1;
      return actual.migrateDocument(...args);
    },
  };
});

import { nextlySingleTags, nextlySiteSettingsTags } from "nextly/runtime";

import { afterOverrunLines } from "./__tests__/overrun-quiet";
import { throughBoundary } from "./__tests__/through-boundary";
import { coreBlocks } from "./blocks";
import type {
  BlocksFieldShapeRef,
  BlocksPublicReader,
  BlocksSiteSettings,
} from "./context";
import { createBlocksPage, createPublicBlocksPage } from "./next";
import type { PageRendererProps } from "./page-renderer";
import { PageRenderer } from "./page-renderer";
import { createBlockResolver } from "./resolver";

const blocks = createBlockResolver(coreBlocks);

async function renderToHtml(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return await new Response(stream).text();
}

/** A page of one heading bound to the entry. */
function boundPage(binding: Record<string, unknown>): BlockDocument {
  return JSON.parse(
    JSON.stringify({
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "h",
          type: "core/heading",
          version: 1,
          props: { text: "Own", level: "h1" },
          bindings: { text: { fallback: "Fallback", ...binding } },
        },
      ],
    })
  ) as BlockDocument;
}

/** Whether a Direct API read is the public reader's: its fixed options. */
function isPublicRead(args: Record<string, unknown>): boolean {
  return (
    args.status === "published" &&
    args.overrideAccess === false &&
    args.unknownSort === "refuse"
  );
}

/**
 * A Direct API whose route read and public read answer differently: the row
 * the route resolves says "Trusted", the public's says "Public".
 */
/** Stored component definitions and Layout rows a test's site holds. */
interface SiteExtras {
  components?: Record<string, unknown>;
  layouts?: Record<string, unknown>;
}

/** The rows of a by-id list read over one store. */
function rowsById(
  args: Record<string, unknown>,
  store: Record<string, unknown>,
  field: string
): Record<string, unknown>[] {
  const where = args.where as { id?: { in?: unknown } } | undefined;
  const ids = Array.isArray(where?.id?.in) ? (where.id.in as string[]) : [];
  return ids
    .filter(id => Object.hasOwn(store, id))
    .map(id => ({ id, [field]: store[id] }));
}

/** The rows a read of one collection answers with on this test's site. */
function rowsFor(
  args: Record<string, unknown>,
  content: BlockDocument,
  extras: SiteExtras
): Record<string, unknown>[] {
  switch (args.collection) {
    case "components":
      return rowsById(args, extras.components ?? {}, "content");
    case "layouts":
      return rowsById(args, extras.layouts ?? {}, "areas");
    case "authors":
      return [{ id: "a1", name: "Ada" }];
    case "posts":
      return [{ id: "post-1", title: "Public" }];
    default:
      // The page itself: what the public may read of it, or the row the route
      // resolves with its own access.
      return isPublicRead(args)
        ? [
            {
              id: "p1",
              title: "Public",
              startsAt: "2026-03-29T18:30:00.000Z",
              author: "a1",
            },
          ]
        : [
            {
              id: "p1",
              slug: "about",
              title: "Trusted",
              startsAt: "2026-03-29T18:30:00.000Z",
              content,
            },
          ];
  }
}

function instance(content: BlockDocument, extras: SiteExtras = {}) {
  const find = vi.fn(async (args: Record<string, unknown>) => ({
    items: rowsFor(args, content, extras),
    meta: { total: 1 },
  }));
  return {
    find,
    findByID: vi.fn(async () => null),
    findSingle: vi.fn(async (args: { slug: string }) =>
      args.slug === "home" ? { id: "h1", tagline: "From the Single" } : null
    ),
    // The instance's own site settings: what the test's site has set.
    publicSiteSettings: vi.fn(async (): Promise<PublicSiteSettings> => {
      if (runtime.site === null) throw new Error("no site settings");
      return runtime.site;
    }),
    media: {
      findByID: vi.fn(
        async (_args: {
          id: string;
          disableErrors?: boolean;
        }): Promise<Record<string, unknown> | null> => null
      ),
    },
  };
}

type Instance = ReturnType<typeof instance>;
type PageConfig = Omit<Parameters<typeof createBlocksPage>[0], "nextly">;

async function renderedPage(
  factory: typeof createBlocksPage | typeof createPublicBlocksPage,
  config: PageConfig,
  nextly: Instance
): Promise<{ element: ReactElement<PageRendererProps>; html: string }> {
  const route = factory({ ...config, nextly: nextly as never });
  const element = await throughBoundary<PageRendererProps>(
    route.ContentPage({ params: { slug: ["about"] } })
  );
  const html = await renderToHtml(createElement(PageRenderer, element.props));
  return { element, html };
}

/** The Direct API arguments of every public read. */
function publicReads(nextly: Instance): Record<string, unknown>[] {
  return nextly.find.mock.calls
    .map(([args]) => args)
    .filter(args => isPublicRead(args));
}

beforeEach(() => {
  runtime.site = null;
  runtime.processSiteReads = 0;
  runtime.shapes = new Map();
  runtime.tags = [];
  runtime.reads = [];
  runtime.pipelineRuns = 0;
  runtime.judged = [];
  runtime.uncached = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a routed page's bindings", () => {
  it.each([
    ["an access-enforced route", createBlocksPage],
    ["a public route", createPublicBlocksPage],
  ] as const)(
    "an entry binding reads the entry again through the public reader, never the row the route resolved (%s)",
    async (_name, factory) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const nextly = instance(boundPage({ $bind: "title" }));
      const { html } = await renderedPage(
        factory,
        { collections: ["pages"], field: "content", blocks },
        nextly
      );
      expect(html).toContain("Public");
      expect(html).not.toContain("Trusted");
      // One read of the entry, by its id, for the fields the page binds.
      expect(publicReads(nextly)).toEqual([
        expect.objectContaining({
          collection: "pages",
          where: { and: [{ id: { equals: "p1" } }] },
          select: { id: true, title: true },
          limit: 1,
        }),
      ]);
    }
  );

  it("an entry read costs a claim on the page's budget, and a refused claim renders the fallback", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const nextly = instance(boundPage({ $bind: "title" }));
    const { html } = await renderedPage(
      createBlocksPage,
      { collections: ["pages"], field: "content", blocks, maxQueries: 0 },
      nextly
    );
    expect(publicReads(nextly)).toEqual([]);
    expect(html).toContain("Fallback");
    expect(html).not.toContain("Trusted");
    // Reported once, naming the page and the problem, never a value.
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('"about"');
    expect(message).toContain("binding-source-unavailable");
    expect(message).not.toContain("Trusted");
  });

  it("passes the route's time zone to the render, and UTC when none or an invalid one is set", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const document = boundPage({
      $bind: "startsAt",
      format: {
        type: "date",
        options: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
      },
    });
    const base = { collections: ["pages"], field: "content", blocks };

    const paris = await renderedPage(
      createBlocksPage,
      { ...base, timeZone: "Europe/Paris" },
      instance(document)
    );
    expect(paris.element.props.bindings?.timeZone).toBe("Europe/Paris");
    expect(paris.html).toContain("20:30");

    const unset = await renderedPage(
      createBlocksPage,
      base,
      instance(document)
    );
    expect(unset.element.props.bindings?.timeZone).toBeUndefined();
    expect(unset.html).toContain("18:30");

    const invalid = await renderedPage(
      createBlocksPage,
      { ...base, timeZone: "Not/AZone" },
      instance(document)
    );
    expect(invalid.html).toContain("18:30");
    expect(
      warn.mock.calls.some(([message]) => String(message).includes("Not/AZone"))
    ).toBe(true);
  });

  it("metadata derives from bound props", async () => {
    let title: string | undefined;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      blocks,
      nextly: instance(boundPage({ $bind: "title" })) as never,
      metadata: (_entry, _context, derived) => {
        title = derived.title;
        return {};
      },
    });
    await route.generateMetadata({ params: { slug: ["about"] } });
    expect(title).toBe("Public");
  });

  it("offers a list item's bound image outside any list as the page draws it: its fallback, never its own", async () => {
    // An image bound to a list item, placed outside every list: the page
    // draws the binding's fallback there, so the share image is that too,
    // not the picture the block holds of its own. The heading bound to the
    // entry makes the page read its bindings, which is when an item's are
    // filled at all; with none read, the page and its metadata both keep the
    // block's own value.
    const document = JSON.parse(
      JSON.stringify({
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [
          {
            id: "h",
            type: "core/heading",
            version: 1,
            props: { text: "Own", level: "h1" },
            bindings: { text: { $bind: "title" } },
          },
          {
            id: "picture",
            type: "core/image",
            version: 1,
            props: { src: "/own.jpg", alt: "Own" },
            bindings: {
              mediaId: {
                source: "item",
                $bind: "photo",
                fallback: "/fallback.jpg",
              },
            },
          },
        ],
      })
    ) as BlockDocument;
    let image: string | undefined;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      blocks,
      nextly: instance(document) as never,
      metadata: (_entry, _context, derived) => {
        image = derived.image;
        return {};
      },
    });
    await route.generateMetadata({ params: { slug: ["about"] } });
    expect(image).toBe("/fallback.jpg");
  });

  it("metadata takes the document's own title, joined from literal and bound segments, over its blocks'", async () => {
    runtime.site = {
      applicationName: "Acme",
      siteUrl: null,
      logoUrl: null,
      timezone: null,
    };
    const document = JSON.parse(
      JSON.stringify({
        ...boundPage({ $bind: "title" }),
        settings: {
          seo: {
            title: [
              { $bind: "title" },
              " | ",
              { $bind: "applicationName", source: "site" },
            ],
            description: ["About ", { $bind: "title" }],
          },
        },
      })
    ) as BlockDocument;
    let derived: { title?: string; description?: string } = {};
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      blocks,
      nextly: instance(document) as never,
      metadata: (_entry, _context, seo) => {
        derived = seo;
        return {};
      },
    });
    await route.generateMetadata({ params: { slug: ["about"] } });
    // The entry's value as the public reads it, not the trusted row's.
    expect(derived.title).toBe("Public | Acme");
    expect(derived.description).toBe("About Public");
  });

  it("reports a metadata binding the route could not use, naming the page", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const document = JSON.parse(
      JSON.stringify({
        ...boundPage({ $bind: "title" }),
        settings: { seo: { title: ["Hello ", { $bind: "not a path" }] } },
      })
    ) as BlockDocument;
    const route = createBlocksPage({
      collections: ["pages"],
      field: "content",
      blocks,
      nextly: instance(document) as never,
      metadata: () => ({}),
    });
    await route.generateMetadata({ params: { slug: ["about"] } });
    expect(
      warn.mock.calls.some(
        ([message]) =>
          String(message).includes('page "about"') &&
          String(message).includes("binding-malformed")
      )
    ).toBe(true);
    warn.mockRestore();
  });

  it("a page whose slots nest deeper than the call stack still renders", async () => {
    // Stored content that bypassed validation: a chain far past the caps the
    // read pipeline repairs to, holding a binding at the top.
    let chain: Record<string, unknown> = {
      id: "leaf",
      type: "core/text",
      version: 1,
      props: { text: "Deep" },
    };
    for (let depth = 0; depth < 50_000; depth += 1) {
      chain = {
        id: `box-${String(depth)}`,
        type: "core/box",
        version: 1,
        props: {},
        slots: { children: [chain] },
      };
    }
    const document = boundPage({ $bind: "title" });
    const content = { ...document, nodes: [...document.nodes, chain] };
    const nextly = instance(content as BlockDocument);
    const { html } = await renderedPage(
      createBlocksPage,
      { collections: ["pages"], field: "content", blocks },
      nextly
    );
    expect(html).toContain("Public");
  });

  it("a binding on a node the shape repair drops claims no read", async () => {
    // A stored node with no usable version: the read pipeline drops it before
    // anything renders, so its entry binding must not spend the page's one
    // claim, which the list beside it needs.
    const content = JSON.parse(
      JSON.stringify({
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [
          {
            id: "dropped",
            type: "core/heading",
            version: 1.5,
            props: { text: "Own", level: "h1" },
            bindings: { text: { $bind: "title" } },
          },
          {
            id: "loop",
            type: "core/collection-loop",
            version: 1,
            props: { collection: "posts", limit: 1 },
            slots: {
              children: [
                {
                  id: "item",
                  type: "core/heading",
                  version: 1,
                  props: { text: "Own", level: "h2" },
                  bindings: { text: { $bind: "title", source: "item" } },
                },
              ],
            },
          },
        ],
      })
    ) as BlockDocument;
    const nextly = instance(content);
    const { html } = await renderedPage(
      createBlocksPage,
      { collections: ["pages"], field: "content", blocks, maxQueries: 1 },
      nextly
    );
    expect(publicReads(nextly).map(args => args.collection)).toEqual(["posts"]);
    expect(html).toContain("Public");
  });

  it("a binding on a node the page de-duplicates claims no read", async () => {
    // A later node reusing the list's address never reaches the page, so it
    // may not spend the one claim the list needs. (A conditioned block may
    // show once its entry is read, so its bindings do read: covered below.)
    const entryBound = (id: string, extra: Record<string, unknown> = {}) => ({
      id,
      type: "core/heading",
      version: 1,
      props: { text: "Own", level: "h1" },
      bindings: { text: { $bind: "title" } },
      ...extra,
    });
    const content = JSON.parse(
      JSON.stringify({
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [
          {
            id: "loop",
            type: "core/collection-loop",
            version: 1,
            props: { collection: "posts", limit: 1 },
            slots: {
              children: [
                {
                  id: "item",
                  type: "core/heading",
                  version: 1,
                  props: { text: "Own", level: "h2" },
                  bindings: { text: { $bind: "title", source: "item" } },
                },
              ],
            },
          },
          entryBound("loop"),
        ],
      })
    ) as BlockDocument;
    const nextly = instance(content);
    const { html } = await renderedPage(
      createBlocksPage,
      { collections: ["pages"], field: "content", blocks, maxQueries: 1 },
      nextly
    );
    expect(publicReads(nextly).map(args => args.collection)).toEqual(["posts"]);
    expect(html).toContain("Public");
  });

  it("a page with no binding reads nothing more and renders as it did", async () => {
    const nextly = instance({
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "h",
          type: "core/heading",
          version: 1,
          props: { text: "Own", level: "h1" },
        },
      ],
    });
    const { element, html } = await renderedPage(
      createBlocksPage,
      { collections: ["pages"], field: "content", blocks },
      nextly
    );
    expect(publicReads(nextly)).toEqual([]);
    expect(element.props.bindings).toBeUndefined();
    expect(html).toContain("Own");
  });
  it("reads Singles and the site settings through the public reads, each at one claim and tagged", async () => {
    runtime.site = {
      applicationName: "Acme",
      siteUrl: null,
      logoUrl: null,
      timezone: null,
    };
    const content = JSON.parse(
      JSON.stringify({
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [
          {
            id: "s",
            type: "core/heading",
            version: 1,
            props: { text: "Own", level: "h1" },
            bindings: {
              text: { $bind: "tagline", source: "single", sourceKey: "home" },
            },
          },
          {
            id: "n",
            type: "core/heading",
            version: 1,
            props: { text: "Own", level: "h2" },
            bindings: { text: { $bind: "applicationName", source: "site" } },
          },
        ],
      })
    ) as BlockDocument;
    const nextly = instance(content);
    const page = await renderedPage(
      createBlocksPage,
      { collections: ["pages"], field: "content", blocks },
      nextly
    );
    expect(page.html).toContain("From the Single");
    expect(page.html).toContain("Acme");
    expect(nextly.findSingle).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "home", overrideAccess: false })
    );
    const tags = runtime.tags.flat();
    expect(tags).toEqual(
      expect.arrayContaining([
        ...nextlySingleTags("home"),
        ...nextlySiteSettingsTags(),
      ])
    );
    // Each source is one claim: with none left, both fall back.
    const starved = await renderedPage(
      createBlocksPage,
      { collections: ["pages"], field: "content", blocks, maxQueries: 0 },
      instance(content)
    );
    expect(starved.html).not.toContain("From the Single");
    expect(starved.html).not.toContain("Acme");
  });

  it("shows date-times in the site's time zone when the route sets none, and the route's overrides it", async () => {
    runtime.site = {
      applicationName: null,
      siteUrl: null,
      logoUrl: null,
      timezone: "Europe/Paris",
    };
    const document = boundPage({
      $bind: "startsAt",
      format: {
        type: "date",
        options: { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
      },
    });
    const base = { collections: ["pages"], field: "content", blocks };
    const site = await renderedPage(createBlocksPage, base, instance(document));
    expect(site.html).toContain("20:30");
    const route = await renderedPage(
      createBlocksPage,
      { ...base, timeZone: "Asia/Tokyo" },
      instance(document)
    );
    expect(route.html).toContain("03:30");
  });

  it("follows one to-one relation with a second public read by id", async () => {
    runtime.shapes.set("collection:pages", [
      { name: "title", type: "text" },
      { name: "author", type: "relationship", relationTo: "authors" },
    ]);
    runtime.shapes.set("collection:authors", [{ name: "name", type: "text" }]);
    const nextly = instance(boundPage({ $bind: "author.name" }));
    const { html } = await renderedPage(
      createBlocksPage,
      { collections: ["pages"], field: "content", blocks },
      nextly
    );
    expect(html).toContain("Ada");
    expect(publicReads(nextly)).toEqual([
      expect.objectContaining({
        collection: "pages",
        select: { id: true, author: true },
      }),
      expect.objectContaining({
        collection: "authors",
        where: { and: [{ id: { equals: "a1" } }] },
        select: { id: true, name: true },
      }),
    ]);
  });

  describe("a link to the entry a to-one relation names", () => {
    /** A page of one button linking to the author, else to `/authors`. */
    const linkPage = (): BlockDocument =>
      JSON.parse(
        JSON.stringify({
          formatVersion: DOCUMENT_FORMAT_VERSION,
          kind: "page",
          nodes: [
            {
              id: "by",
              type: "core/button",
              version: 1,
              props: {
                label: "The author",
                href: "/authors",
                entryCollection: "authors",
              },
              bindings: { entryId: { $bind: "author.id" } },
            },
          ],
        })
      ) as BlockDocument;

    const config: PageConfig = {
      collections: ["pages"],
      field: "content",
      blocks,
      resolveEntryPath: async (collection, id) => `/${collection}/${id}`,
    };

    beforeEach(() => {
      runtime.shapes.set("collection:pages", [
        { name: "title", type: "text" },
        { name: "author", type: "relationship", relationTo: "authors" },
      ]);
      // As declared: the authors list no `id`, which every entry carries.
      runtime.shapes.set("collection:authors", [
        { name: "name", type: "text" },
      ]);
    });

    it("links to the author's page, its id read from the author as the public reads it", async () => {
      const nextly = instance(linkPage());
      const { html } = await renderedPage(createBlocksPage, config, nextly);
      expect(html).toContain('href="/authors/a1"');
      expect(publicReads(nextly)).toEqual([
        expect.objectContaining({
          collection: "pages",
          select: { id: true, author: true },
        }),
        expect.objectContaining({
          collection: "authors",
          where: { and: [{ id: { equals: "a1" } }] },
          select: { id: true },
        }),
      ]);
    });

    it("links to its own address where the public may not read the author", async () => {
      const nextly = instance(linkPage());
      const answer = nextly.find.getMockImplementation();
      // The authors' read refused, as a collection the public may not read
      // is; the post still holds the author's id, which never fills the link.
      nextly.find.mockImplementation(async (args: Record<string, unknown>) => {
        if (args.collection === "authors" && isPublicRead(args)) {
          throw new Error("forbidden");
        }
        if (answer === undefined) throw new Error("no find");
        return await answer(args);
      });
      const { html } = await renderedPage(createBlocksPage, config, nextly);
      expect(html).toContain('href="/authors"');
      expect(html).not.toContain("/authors/a1");
    });

    it("links to its own address where the author's entry has no page", async () => {
      const nextly = instance(linkPage());
      // The author is read, so the entry is named, but no path is found.
      const resolved: string[] = [];
      const { html } = await renderedPage(
        createBlocksPage,
        {
          ...config,
          resolveEntryPath: async (collection, id) => {
            resolved.push(`${collection}:${id}`);
            return null;
          },
        },
        nextly
      );
      expect(resolved).toEqual(["authors:a1"]);
      expect(html).toContain('href="/authors"');
    });
  });

  it("follows a relation into the media library through the library, as the page's images are read", async () => {
    runtime.shapes.set("collection:pages", [
      { name: "title", type: "text" },
      { name: "cover", type: "upload", relationTo: "media" },
    ]);
    const page = boundPage({ $bind: "cover.altText" });
    const nextly = instance(page);
    // The page's public row points at its cover, and `media` is no
    // collection a list read finds: asking it for one fails, as it does on
    // a real instance.
    nextly.find.mockImplementation(async (args: Record<string, unknown>) => {
      if (args.collection === "media") throw new Error("not a collection");
      const rows = rowsFor(args, page, {});
      const items = isPublicRead(args)
        ? rows.map(row => ({ ...row, cover: "m1" }))
        : rows;
      return { items, meta: { total: 1 } };
    });
    nextly.media.findByID.mockImplementation(async ({ id }) =>
      id === "m1"
        ? { id: "m1", url: "/m1.jpg", altText: "A harbour at dawn" }
        : null
    );
    const { html } = await renderedPage(
      createBlocksPage,
      { collections: ["pages"], field: "content", blocks },
      nextly
    );
    expect(html).toContain("A harbour at dawn");
    expect(html).not.toContain("Fallback");
    expect(nextly.media.findByID).toHaveBeenCalledWith({
      id: "m1",
      disableErrors: true,
    });
  });

  it("judges what the public may see inside the cached reads, so a prerender can cache the page", async () => {
    runtime.shapes.set("collection:pages", [
      { name: "title", type: "text" },
      { name: "author", type: "relationship", relationTo: "authors" },
    ]);
    runtime.shapes.set("collection:authors", [{ name: "name", type: "text" }]);
    const content = JSON.parse(
      JSON.stringify({
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [
          {
            id: "e",
            type: "core/heading",
            version: 1,
            props: { text: "Own", level: "h1" },
            bindings: { text: { $bind: "author.name" } },
          },
          {
            id: "s",
            type: "core/heading",
            version: 1,
            props: { text: "Own", level: "h2" },
            bindings: {
              text: { $bind: "tagline", source: "single", sourceKey: "home" },
            },
          },
          {
            id: "loop",
            type: "core/collection-loop",
            version: 1,
            props: { collection: "posts", limit: 1 },
            slots: {
              children: [
                {
                  id: "item",
                  type: "core/heading",
                  version: 1,
                  props: { text: "Own", level: "h3" },
                  bindings: { text: { $bind: "title", source: "item" } },
                },
              ],
            },
          },
        ],
      })
    ) as BlockDocument;
    const { html } = await renderedPage(
      createPublicBlocksPage,
      { collections: ["pages"], field: "content", blocks },
      instance(content)
    );
    expect(html).toContain("Ada");
    expect(html).toContain("From the Single");
    expect(html).toContain("Public");
    // The control: every kind of judgement was made, for every source read.
    expect(runtime.judged).toEqual(
      expect.arrayContaining([
        "hidden collection:pages",
        "hidden collection:authors",
        "hidden single:home",
        "hidden collection:posts",
        "shapes collection:pages",
        "shapes collection:authors",
        "shapes single:home",
        "shapes collection:posts",
      ])
    );
    expect(runtime.uncached).toEqual([]);
  });

  it("a public route reads its site styles inside the cached read, tagged with their Singles", async () => {
    const seen: boolean[] = [];
    const config = {
      collections: ["pages"],
      field: "content",
      blocks,
      siteStyles: {
        read: () => {
          seen.push(runtime.isCached());
          return undefined;
        },
        singles: ["site-style"],
      },
    };
    await renderedPage(
      createPublicBlocksPage,
      config,
      instance(boundPage({ $bind: "title" }))
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
    expect(runtime.tags).toContainEqual(nextlySingleTags("site-style"));
    // An access-enforced route reads them per request, outside any cache.
    seen.length = 0;
    await renderedPage(
      createBlocksPage,
      config,
      instance(boundPage({ $bind: "title" }))
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some(Boolean)).toBe(false);
  });

  it("names a public route's cached site styles by the route and its provider, never sharing them", async () => {
    const base = { collections: ["pages"], field: "content", blocks };
    const brand = {
      read: () => ({ tokenPrefix: "brand" }),
      singles: ["brand-style"],
    };
    const campaign = {
      read: () => ({ tokenPrefix: "campaign" }),
      singles: ["campaign-style"],
    };
    // Another provider declaring the same Singles, told apart by its read.
    const sameSingles = {
      read: () => ({ tokenPrefix: "seasonal" }),
      singles: ["brand-style"],
    };
    const keyOf = async (siteStyles: typeof brand) => {
      runtime.reads = [];
      await renderedPage(
        createPublicBlocksPage,
        { ...base, siteStyles },
        instance(boundPage({ $bind: "title" }))
      );
      const read = runtime.reads.find(
        entry => entry.keyParts[0] === "nextly-public-site-styles"
      );
      if (read === undefined) throw new Error("no cached site style read");
      return read;
    };
    const first = await keyOf(brand);
    const again = await keyOf(brand);
    const other = await keyOf(campaign);
    const twin = await keyOf(sameSingles);
    // The control: the same route and provider name one entry every time.
    expect(again.keyParts).toEqual(first.keyParts);
    expect(other.keyParts).not.toEqual(first.keyParts);
    expect(twin.keyParts).not.toEqual(first.keyParts);
    // Each entry carries its own provider's Singles only.
    expect(first.tags).toEqual(nextlySingleTags("brand-style"));
    expect(other.tags).toEqual(nextlySingleTags("campaign-style"));
  });

  it("prepares each document once per render, and the renderer reuses that preparation", async () => {
    const element = await throughBoundary<PageRendererProps>(
      createBlocksPage({
        collections: ["pages"],
        field: "content",
        blocks,
        nextly: instance(boundPage({ $bind: "title" })) as never,
      }).ContentPage({ params: { slug: ["about"] } })
    );
    expect(runtime.pipelineRuns).toBe(1);
    const html = await renderToHtml(createElement(PageRenderer, element.props));
    expect(html).toContain("Public");
    expect(runtime.pipelineRuns).toBe(1);
  });

  it("a binding on a node the page draws as a placeholder claims no read", async () => {
    const entryBound = (id: string, extra: Record<string, unknown>) => ({
      id,
      type: "core/heading",
      version: 1,
      props: { text: "Own", level: "h1" },
      bindings: { text: { $bind: "title" } },
      ...extra,
    });
    const content = JSON.parse(
      JSON.stringify({
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [
          entryBound("unknown", { type: "plugin/unregistered" }),
          entryBound("failed", { migrationFailed: true }),
          entryBound("ahead", { version: 99 }),
          {
            id: "loop",
            type: "core/collection-loop",
            version: 1,
            props: { collection: "posts", limit: 1 },
            slots: {
              children: [
                {
                  id: "item",
                  type: "core/heading",
                  version: 1,
                  props: { text: "Own", level: "h2" },
                  bindings: { text: { $bind: "title", source: "item" } },
                },
              ],
            },
          },
        ],
      })
    ) as BlockDocument;
    const nextly = instance(content);
    const { html } = await renderedPage(
      createBlocksPage,
      { collections: ["pages"], field: "content", blocks, maxQueries: 1 },
      nextly
    );
    expect(publicReads(nextly).map(args => args.collection)).toEqual(["posts"]);
    expect(html).toContain("Public");
  });

  it("spends the budget in the same order for the page and its metadata, so a bound title cannot differ", async () => {
    const header = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [
        {
          id: "hb",
          type: "core/text",
          version: 1,
          props: { text: "Header" },
        },
      ],
    };
    const extras: SiteExtras = {
      components: { hdr: header },
      layouts: { main: [{ area: "header", component: "hdr" }] },
    };
    for (let maxQueries = 0; maxQueries <= 4; maxQueries += 1) {
      let title: string | undefined;
      const config = {
        collections: ["pages"],
        field: "content",
        blocks,
        maxQueries,
        layouts: {
          readDefault: async () => "main",
          singles: ["page-builder-settings"],
        },
        metadata: (
          _entry: unknown,
          _context: unknown,
          derived: { title?: string }
        ) => {
          title = derived.title;
          return {};
        },
      };
      const route = createBlocksPage({
        ...config,
        nextly: instance(boundPage({ $bind: "title" }), extras) as never,
      } as Parameters<typeof createBlocksPage>[0]);
      await route.generateMetadata({ params: { slug: ["about"] } });
      const element = await throughBoundary<PageRendererProps>(
        route.ContentPage({ params: { slug: ["about"] } })
      );
      const html = await renderToHtml(element);
      const shown = /<h1[^>]*>(.*?)<\/h1>/.exec(html)?.[1];
      expect(shown, `maxQueries ${String(maxQueries)}`).toBe(title);
    }
  });

  it("reads for a binding a component places deeper than the page's own depth cap", async () => {
    const box = (id: string, children: unknown[]) => ({
      id,
      type: "core/box",
      version: 1,
      props: {},
      slots: { children },
    });
    const component = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "component",
      nodes: [
        box("c1", [
          box("c2", [
            {
              id: "deep",
              type: "core/heading",
              version: 1,
              props: { text: "Own", level: "h1" },
              bindings: { text: { $bind: "title" } },
            },
          ]),
        ]),
      ],
    };
    const content = JSON.parse(
      JSON.stringify({
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [
          box("p1", [
            box("p2", [
              {
                id: "i",
                type: COMPONENT_INSTANCE_TYPE,
                version: 1,
                props: { componentId: "cmp" },
              },
            ]),
          ]),
        ],
      })
    ) as BlockDocument;
    const nextly = instance(content, { components: { cmp: component } });
    const { html } = await renderedPage(
      createBlocksPage,
      {
        collections: ["pages"],
        field: "content",
        blocks,
        limits: { ...DEFAULT_LIMITS, maxDepth: 4 },
      },
      nextly
    );
    // The control: the component's heading is on the page, past depth 4.
    expect(html).toMatch(/<h1[^>]*>/);
    expect(html).toContain("Public");
  });

  it("writes out nextly's public source types in this package", () => {
    expectTypeOf<PublicSourceReader>().toExtend<BlocksPublicReader>();
    expectTypeOf<PublicSiteSettings>().toEqualTypeOf<BlocksSiteSettings>();
    expectTypeOf<NextlyBindingFieldShape>().toExtend<BindingFieldShape>();
    expectTypeOf<BindingSourceRef>().toExtend<BlocksFieldShapeRef>();
    expectTypeOf<BlocksFieldShapeRef>().toExtend<BindingSourceRef>();
  });
});

describe("a page's site settings, in a process serving several sites", () => {
  /** An instance of one site, whose own settings name it and set its zone. */
  function siteInstance(
    content: BlockDocument,
    applicationName: string,
    timezone: string
  ): Instance {
    const nextly = instance(content);
    nextly.publicSiteSettings.mockImplementation(async () => ({
      applicationName,
      siteUrl: null,
      logoUrl: null,
      timezone,
    }));
    return nextly;
  }

  /** A page showing its site's name and the entry's date-time in the site's zone. */
  const sitePage = JSON.parse(
    JSON.stringify({
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "name",
          type: "core/heading",
          version: 1,
          props: { text: "Own", level: "h1" },
          bindings: {
            text: {
              fallback: "No name",
              $bind: "applicationName",
              source: "site",
            },
          },
        },
        {
          id: "when",
          type: "core/heading",
          version: 1,
          props: { text: "Own", level: "h2" },
          bindings: {
            text: {
              fallback: "No time",
              $bind: "startsAt",
              format: {
                type: "date",
                options: {
                  hour: "2-digit",
                  minute: "2-digit",
                  hourCycle: "h23",
                },
              },
            },
          },
        },
      ],
    })
  ) as BlockDocument;

  /** A list filtering by a day, which compares days in the site's zone. */
  const dayList: BlockDocument = {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "list",
        type: "core/collection-loop",
        version: 1,
        props: {
          collection: "posts",
          filters: [
            {
              field: "publishedAt",
              op: "greater_than_equal",
              value: "2026-09-01",
            },
          ],
        },
      },
    ],
  };

  const base = { collections: ["pages"], field: "content", blocks };

  /** The site settings reads made, by their cache keys. */
  function siteReadKeys(): string[][] {
    return runtime.reads
      .filter(read =>
        nextlySiteSettingsTags().every(tag => read.tags.includes(tag))
      )
      .map(read => read.keyParts);
  }

  beforeEach(() => {
    // The process has a registered instance with a site of its own, so a
    // page that reached for it would show that site rather than nothing.
    runtime.site = {
      applicationName: "Process site",
      siteUrl: null,
      logoUrl: null,
      timezone: "Asia/Tokyo",
    };
  });

  it("each route's page shows its own instance's site name and time zone, never the process's", async () => {
    const acme = siteInstance(sitePage, "Acme", "Europe/Paris");
    const globex = siteInstance(sitePage, "Globex", "America/New_York");

    const acmePage = await renderedPage(
      createBlocksPage,
      { ...base, cacheScope: "acme" },
      acme
    );
    const globexPage = await renderedPage(
      createBlocksPage,
      { ...base, cacheScope: "globex" },
      globex
    );

    // 18:30 UTC on 29 March 2026: 20:30 in Paris, 14:30 in New York, and
    // 03:30 the next day in the process site's Tokyo.
    expect(acmePage.html).toContain("Acme");
    expect(acmePage.html).toContain("20:30");
    expect(acmePage.element.props.bindings?.timeZone).toBe("Europe/Paris");
    expect(globexPage.html).toContain("Globex");
    expect(globexPage.html).toContain("14:30");
    expect(globexPage.element.props.bindings?.timeZone).toBe(
      "America/New_York"
    );
    for (const html of [acmePage.html, globexPage.html]) {
      expect(html).not.toContain("Process site");
      expect(html).not.toContain("03:30");
    }
    expect(acmePage.html).not.toContain("Globex");
    expect(globexPage.html).not.toContain("Acme");

    // Read from each route's own instance, and never from the process's.
    expect(acme.publicSiteSettings).toHaveBeenCalled();
    expect(globex.publicSiteSettings).toHaveBeenCalled();
    expect(runtime.processSiteReads).toBe(0);
    // Cached under each route's own scope, so the two never share an entry.
    expect(siteReadKeys()).toEqual([
      ["nextly-public-site-settings", "acme"],
      ["nextly-public-site-settings", "globex"],
    ]);
  });

  it("a list filtering by a day compares days in its own instance's time zone", async () => {
    const zoneOf = async (nextly: Instance, cacheScope: string) => {
      const route = createBlocksPage({
        ...base,
        cacheScope,
        nextly: nextly as never,
      });
      const element = await throughBoundary<PageRendererProps>(
        route.ContentPage({ params: { slug: ["about"] } })
      );
      return element.props.context?.timeZone;
    };

    await expect(
      zoneOf(siteInstance(dayList, "Acme", "Europe/Paris"), "acme")
    ).resolves.toBe("Europe/Paris");
    await expect(
      zoneOf(siteInstance(dayList, "Globex", "America/New_York"), "globex")
    ).resolves.toBe("America/New_York");
    expect(runtime.processSiteReads).toBe(0);
  });

  it("reads the site settings once for a page whose list compares days and whose query asks today", async () => {
    // A custom source of rows with their own date field, its items hidden
    // by a condition ordering that date: the list's days need the zone, and
    // the query's run asks for today in it. One question, asked twice.
    const soon = defineNamedQuery({
      name: "events.soon",
      label: "Events soon",
      reads: {},
      rows: {
        key: "id",
        fields: [
          { name: "id", type: "text" },
          { name: "startsAt", type: "date" },
        ],
      },
      run: () => Promise.resolve({ rows: [{ id: "e1", startsAt: null }] }),
    });
    const events = JSON.parse(
      JSON.stringify({
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [
          {
            id: "list",
            type: "core/collection-loop",
            version: 1,
            props: { namedQuery: { name: "events.soon", params: {} } },
            slots: {
              children: [
                {
                  id: "badge",
                  type: "core/heading",
                  version: 1,
                  props: { text: "Soon", level: "h3" },
                  visibility: {
                    conditions: [
                      [
                        {
                          field: "startsAt",
                          op: "greater_than",
                          value: "2026-11-01",
                        },
                      ],
                    ],
                  },
                },
              ],
              empty: [],
            },
          },
        ],
      })
    ) as BlockDocument;
    const route = createBlocksPage({
      ...base,
      cacheScope: "acme",
      namedQueries: {
        definitionOf: name => (name === soon.name ? soon : undefined),
      },
      nextly: siteInstance(events, "Acme", "Europe/Paris") as never,
    });
    const element = await throughBoundary<PageRendererProps>(
      route.ContentPage({ params: { slug: ["about"] } })
    );
    // The zone was read, from this instance's settings.
    expect(element.props.context?.timeZone).toBe("Europe/Paris");
    const siteReads = runtime.reads.filter(
      read => read.keyParts[0] === "nextly-public-site-settings"
    );
    expect(siteReads).toHaveLength(1);
  });

  /** A reader of the app's own that forwards no site-settings read. */
  function readerWithoutSite(
    content: BlockDocument
  ): Omit<Instance, "publicSiteSettings"> {
    const { publicSiteSettings: _dropped, ...rest } = instance(content);
    return rest;
  }

  /** The warnings that name a reader's missing site-settings read. */
  function standInWarnings(warn: { mock: { calls: unknown[][] } }): string[] {
    return warn.mock.calls
      .map(([message]) => String(message))
      .filter(message => message.includes("has no `publicSiteSettings`"));
  }

  it("a reader of the app's own with no site-settings read shows the process's, and says so once per reader", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const reader = readerWithoutSite(sitePage);

    const first = await renderedPage(
      createBlocksPage,
      { ...base, cacheScope: "acme" },
      reader as Instance
    );
    // The process's settings, as a route like this read them before an
    // instance could be asked: a single-site app's page keeps its site name.
    expect(first.html).toContain("Process site");
    expect(first.html).toContain("03:30");
    expect(runtime.processSiteReads).toBe(1);
    // Said once, naming the line that makes the route read its own instance.
    const said = standInWarnings(warn);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(
      "publicSiteSettings: async () => (await instance()).publicSiteSettings()"
    );

    // The same reader again is not said again; another reader is.
    await renderedPage(
      createBlocksPage,
      { ...base, cacheScope: "acme" },
      reader as Instance
    );
    expect(standInWarnings(warn)).toHaveLength(1);
    await renderedPage(
      createBlocksPage,
      { ...base, cacheScope: "globex" },
      readerWithoutSite(sitePage) as Instance
    );
    expect(standInWarnings(warn)).toHaveLength(2);
  });

  it("a reader that forwards the site-settings read is never warned about", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await renderedPage(
      createBlocksPage,
      { ...base, cacheScope: "acme" },
      siteInstance(sitePage, "Acme", "Europe/Paris")
    );
    // The control: the page did read its site settings.
    expect(siteReadKeys()).toEqual([["nextly-public-site-settings", "acme"]]);
    expect(standInWarnings(warn)).toEqual([]);
  });
});

describe("a page's blocks shown by their visibility conditions", () => {
  /** A heading shown only when `conditions` hold for the page's entry. */
  const shownWhen = (id: string, text: string, conditions: unknown) => ({
    id,
    type: "core/heading",
    version: 1,
    props: { text, level: "h2" },
    visibility: { conditions },
  });
  const page = (...nodes: Record<string, unknown>[]): BlockDocument =>
    JSON.parse(
      JSON.stringify({
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes,
      })
    ) as BlockDocument;
  const base = { collections: ["pages"], field: "content", blocks };

  beforeEach(() => {
    runtime.shapes.set("collection:pages", [{ name: "title", type: "text" }]);
  });

  it("draws a block whose conditions hold for the public entry and leaves the other out", async () => {
    const nextly = instance(
      page(
        shownWhen("yes", "Shown to everyone", [
          [{ field: "title", op: "equals", value: "Public" }],
        ]),
        shownWhen("no", "Never shown", [
          [{ field: "title", op: "equals", value: "Elsewhere" }],
        ])
      )
    );
    const { html } = await renderedPage(createBlocksPage, base, nextly);
    expect(html).toContain("Shown to everyone");
    expect(html).not.toContain("Never shown");
  });

  it("decides by the entry as the public reads it, never the route's own read", async () => {
    // The route's row says "Trusted"; the public's says "Public".
    const { html } = await renderedPage(
      createBlocksPage,
      base,
      instance(
        page(
          shownWhen("trusted", "Only for trusted", [
            [{ field: "title", op: "equals", value: "Trusted" }],
          ])
        )
      )
    );
    expect(html).not.toContain("Only for trusted");
  });

  it("reads the entry once, for the fields its conditions check, though nothing binds it", async () => {
    const nextly = instance(
      page(shownWhen("yes", "Shown", [[{ field: "title", op: "exists" }]]))
    );
    runtime.reads = [];
    await renderedPage(createBlocksPage, base, nextly);
    expect(publicReads(nextly)).toEqual([
      expect.objectContaining({
        collection: "pages",
        select: { id: true, title: true },
      }),
    ]);
    // Cached under the collection's tags, so editing a field a condition
    // checks refreshes the page and its show-or-hide with it.
    const { nextlyTags } = await import("nextly/runtime");
    expect(
      runtime.reads.some(read =>
        nextlyTags("pages").every(tag => read.tags.includes(tag))
      )
    ).toBe(true);
  });

  it("reads the field shapes of the collection a bound list draws, for its items' conditions", async () => {
    // The list's collection is filled from the entry's title ("Public"); the
    // stored "posts" is only the fallback beside the binding.
    const nextly = instance(
      page({
        id: "loop",
        type: "core/collection-loop",
        version: 1,
        props: { collection: "posts", limit: 1 },
        bindings: { collection: { $bind: "title" } },
        slots: {
          children: [
            shownWhen("pill", "Featured", [[{ field: "title", op: "exists" }]]),
          ],
        },
      })
    );
    await renderedPage(createBlocksPage, base, nextly);
    // Read only from the stored "posts" before, so the bound list's items
    // had no shapes and every condition failed closed.
    expect(runtime.judged).toContain("shapes collection:Public");
  });

  it("reads the site's zone for a list's item conditions only when one orders a date", async () => {
    runtime.shapes.set("collection:posts", [
      { name: "title", type: "text" },
      { name: "rating", type: "number" },
      { name: "publishedAt", type: "date" },
    ]);
    const listWith = (field: string, op: string, value?: unknown) =>
      instance(
        page({
          id: "loop",
          type: "core/collection-loop",
          version: 1,
          props: { collection: "posts", limit: 1 },
          slots: {
            children: [
              shownWhen("pill", "Featured", [
                [
                  {
                    field,
                    op,
                    ...(value === undefined ? {} : { value }),
                  },
                ],
              ]),
            ],
          },
        })
      );
    const siteRead = () =>
      runtime.tags.some(tags =>
        nextlySiteSettingsTags().every(tag => tags.includes(tag))
      );
    // A text match needs the item's field shapes, never the zone, so it
    // spends none of the page's budget on the site and its list still draws.
    runtime.tags = [];
    const { html } = await renderedPage(
      createBlocksPage,
      { ...base, maxQueries: 2 },
      listWith("title", "equals", "Public")
    );
    expect(siteRead()).toBe(false);
    expect(html).toContain("Featured");
    // Nor does ordering a number, which compares no day.
    runtime.tags = [];
    await renderedPage(
      createBlocksPage,
      base,
      listWith("rating", "greater_than", 3)
    );
    expect(siteRead()).toBe(false);
    // CONTROL: ordering a date reads it.
    runtime.tags = [];
    await renderedPage(
      createBlocksPage,
      base,
      listWith("publishedAt", "greater_than", "2026-01-01")
    );
    expect(siteRead()).toBe(true);
  });

  it("prepares a conditioned page three times, never a fourth for metadata's question", async () => {
    await renderedPage(
      createBlocksPage,
      base,
      instance(
        page(
          shownWhen("yes", "Shown", [
            [{ field: "title", op: "equals", value: "Public" }],
          ])
        )
      )
    );
    // Once as stored, once with every conditioned block kept for the reads,
    // once decided by the entry. Metadata's own question about the Layout
    // isn't asked by a render, so it prepares nothing more.
    expect(runtime.pipelineRuns).toBe(3);
  });

  it("prepares a conditioned page three times for its metadata too, reusing the page kept for its question", async () => {
    const route = createBlocksPage({
      ...base,
      nextly: instance(
        page(
          shownWhen("yes", "Shown", [
            [{ field: "title", op: "equals", value: "Public" }],
          ])
        )
      ) as never,
      metadata: (_entry, _context, derived) => ({
        title: derived.title ?? "Page",
      }),
    });
    runtime.pipelineRuns = 0;
    await route.generateMetadata({ params: { slug: ["about"] } });
    // The page kept to ask whether it reads anything is the one its reads
    // are taken from: a fourth preparation would be the same work again.
    expect(runtime.pipelineRuns).toBe(3);
  });

  it("leaves out, and reports, a block whose condition checks a field the public can't read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { html } = await renderedPage(
      createBlocksPage,
      base,
      instance(
        page(
          shownWhen("hidden", "Hidden field", [
            [{ field: "secret", op: "exists" }],
          ])
        )
      )
    );
    expect(html).not.toContain("Hidden field");
    expect(
      warn.mock.calls.some(([message]) =>
        String(message).includes("condition-field-unknown")
      )
    ).toBe(true);
  });

  it("describes the page in its metadata by the blocks it draws", async () => {
    let title: string | undefined;
    const route = createBlocksPage({
      ...base,
      nextly: instance(
        page(
          {
            id: "h1",
            type: "core/heading",
            version: 1,
            props: { text: "Members area", level: "h1" },
            visibility: {
              conditions: [
                [{ field: "title", op: "equals", value: "Elsewhere" }],
              ],
            },
          },
          {
            id: "h2",
            type: "core/heading",
            version: 1,
            props: { text: "Public area", level: "h1" },
            visibility: {
              conditions: [[{ field: "title", op: "equals", value: "Public" }]],
            },
          }
        )
      ) as never,
      metadata: (_entry, _context, derived) => {
        title = derived.title;
        return {};
      },
    });
    await route.generateMetadata({ params: { slug: ["about"] } });
    expect(title).toBe("Public area");
  });
});

describe("the route's log of conditions it can't check", () => {
  it("counts blocks, not conditions, and names each code", async () => {
    runtime.shapes.set("collection:pages", [{ name: "title", type: "text" }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const content = JSON.parse(
      JSON.stringify({
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [
          {
            id: "one",
            type: "core/heading",
            version: 1,
            props: { text: "Two bad conditions", level: "h2" },
            visibility: {
              conditions: [
                [
                  { field: "secret", op: "exists" },
                  { field: "other", op: "exists" },
                ],
              ],
            },
          },
        ],
      })
    ) as BlockDocument;
    await renderedPage(
      createBlocksPage,
      { collections: ["pages"], field: "content", blocks },
      instance(content)
    );
    const said = warn.mock.calls
      .map(([message]) => String(message))
      .find(message => message.includes("visibility conditions"));
    expect(said).toContain("1 block(s)");
    expect(said).toContain("condition-field-unknown x2");
  });
});

// Pages here outrun their caps, and a route logs that after a short quiet.
afterAll(afterOverrunLines);
