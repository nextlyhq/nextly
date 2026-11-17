/**
 * A public route answering a read the public is refused, from the cache.
 *
 * `cachedFind` keeps a refusal as one and throws it again on every read of the
 * entry, outside the cache, where the route answers it as not found. Under
 * Cache Components a prerender refuses the current time outside a cache
 * scope, and a `NextlyError` built the usual way takes it (its `timestamp`),
 * so a route answering a kept refusal failed its build. The property that
 * separates a correct route from the broken one is whether the clock is read
 * OUTSIDE the cache on the way to that answer, which no rendered output
 * shows. So the app's `"use cache"` function is stood in for by one that
 * keeps each entry as Next keeps it (a copy, and no throw), marks what runs
 * inside it, and the clock is watched for reads outside every cached read.
 *
 * The site's current year is the other read of the clock a published page
 * makes: no setting stores it, so it is worked out from the clock, and the
 * same rule holds. It is checked on a page binding the site's settings, for
 * where the clock is read, for the site's time zone deciding the year on 31
 * December, and for the editor's canvas being handed the same year.
 *
 * Driven through the real route, the real reader and the real `cachedFind`,
 * with only the Direct API, the address store and the cache below them faked.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { NextlyError } from "nextly/errors";
import type { PublicSiteSettings } from "nextly/runtime";
import { registerCachedRead, runRegisteredRead } from "nextly/runtime";
import { createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// The real reader, told the fake's declarations (it hides no field), since
// no Nextly services are registered in this process for it to read a schema
// from.
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
  };
});

import { throughBoundary } from "./__tests__/through-boundary";
import { coreBlocks } from "./blocks";
import { createQueryBudget } from "./context";
import {
  createPublicBlocksPage,
  createPublicContentPage,
  readBindingSources,
  type ContentPageConfig,
} from "./next";
import { PageRenderer, type PageRendererProps } from "./page-renderer";
import { createBlockResolver } from "./resolver";

/** What Next.js's `notFound()` throws, for the App Router to answer 404. */
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

const TEMPLATE: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "template",
  nodes: [
    {
      id: "h",
      type: "core/heading",
      version: 1,
      props: { text: "Own", level: "h1" },
    },
  ],
};

/** Marks what runs inside a cached read. */
const inCache = new AsyncLocalStorage<true>();

/** A stand-in for the app's `"use cache"` function, and what it kept. */
interface CacheStandIn {
  readonly kept: Map<string, string>;
  readonly cachedRead: (key: string) => Promise<unknown>;
}

/** What the clock watch saw while it was on. */
interface ClockWatch {
  on: boolean;
  readonly outside: string[];
  inside: number;
}

function useCache(): CacheStandIn {
  const kept = new Map<string, string>();
  const cachedRead = async (key: string): Promise<unknown> => {
    const hit = kept.get(key);
    if (hit !== undefined) return JSON.parse(hit) as unknown;
    const value = await inCache.run(true, () => runRegisteredRead(key));
    const copy = JSON.stringify(value);
    kept.set(key, copy);
    return JSON.parse(copy) as unknown;
  };
  return { kept, cachedRead };
}

/**
 * Every read of the current time (`new Date()` with no arguments, and
 * `Date.now()`) while it is on, outside every cached read and inside one,
 * each outside one by where it was made.
 */
function watchClock(): ClockWatch {
  const RealDate = Date;
  const clock: ClockWatch = { on: false, outside: [], inside: 0 };
  const note = () => {
    if (!clock.on) return;
    if (inCache.getStore() === true) {
      clock.inside += 1;
      return;
    }
    clock.outside.push(new Error("the clock was read here").stack ?? "");
  };
  vi.stubGlobal(
    "Date",
    new Proxy(RealDate, {
      construct(target, args, newTarget) {
        if (args.length === 0) note();
        return Reflect.construct(target, args, newTarget) as object;
      },
      get(target, property, receiver) {
        if (property !== "now") return Reflect.get(target, property, receiver);
        return () => {
          note();
          return target.now();
        };
      },
    })
  );
  return clock;
}

/** A Direct API whose public read of posts is refused, as access refuses it. */
function instance() {
  const refusedReads = vi.fn();
  const find = vi.fn(async (args: Record<string, unknown>) => {
    if (args.collection === "posts") {
      refusedReads(args);
      throw NextlyError.forbidden();
    }
    return { items: [], meta: { total: 0, hasNext: false } };
  });
  return {
    refusedReads,
    nextly: {
      find,
      findByID: vi.fn(async () => null),
      findSingle: vi.fn(async () => null),
      media: { findByID: vi.fn(async () => null) },
    },
  };
}

function config(
  nextly: ReturnType<typeof instance>["nextly"]
): ContentPageConfig {
  return {
    pages: {
      collections: ["pages"],
      field: "content",
      blocks: createBlockResolver(coreBlocks),
      nextly: nextly as never,
      metadata: (_entry, _context, derived) => ({ title: derived.title }),
    },
    resolveAddress: async (_locale, path) =>
      path === "/blog/hello"
        ? { collection: "posts", id: "post-1", kind: "address" }
        : null,
    templates: {
      collection: "templates",
      read: async collection =>
        collection === "posts" ? { id: "t1", document: TEMPLATE } : null,
    },
  };
}

/** What the route's page answers `slug` with: its element, or what it threw. */
async function served(
  route: ReturnType<typeof createPublicContentPage>,
  slug: string[]
): Promise<unknown> {
  return await throughBoundary(route.ContentPage({ params: { slug } })).catch(
    (thrown: unknown) => thrown
  );
}

beforeAll(async () => {
  // Loaded once before the clock is watched: the route imports it on its
  // first not-found, and a module's first evaluation is no request's work.
  await import("next/navigation");
});

let cache: ReturnType<typeof useCache>;

beforeEach(() => {
  // Cache Components on, as the app's build inlines it, so the route reads
  // through the app's `"use cache"` function.
  vi.stubEnv("__NEXT_CACHE_COMPONENTS", "true");
  cache = useCache();
  registerCachedRead(cache.cachedRead, true);
});

afterEach(() => {
  registerCachedRead(cache.cachedRead, false);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a public route over a read the public is refused", () => {
  it("answers not found from the kept refusal without reading the clock outside the cache", async () => {
    const site = instance();
    const route = createPublicContentPage(config(site.nextly));
    const slug = ["blog", "hello"];
    const clock = watchClock();

    // The first request reads, is refused, and keeps the refusal.
    clock.on = true;
    const first = await served(route, slug);
    clock.on = false;
    expect(first).toMatchObject(NOT_FOUND);
    expect(site.refusedReads).toHaveBeenCalledTimes(1);
    // The controls: the refusal was kept as one, so the request after this
    // is answered from it; and the watch sees a refusal's own clock read,
    // made here inside the cache where the Direct API refused.
    expect(
      [...cache.kept.values()].filter(entry =>
        entry.includes('"kept":"refusal"')
      )
    ).toHaveLength(1);
    expect(clock.inside).toBeGreaterThan(0);
    expect(clock.outside).toEqual([]);

    // The second request is a hit: nothing is read again, and the refusal
    // thrown again is answered as not found, with no time taken outside.
    clock.on = true;
    const again = await served(route, slug);
    // The head answers not found too, so a crawler gets a 404.
    const metadata = await route
      .generateMetadata({ params: { slug } })
      .catch((error: unknown) => error);
    clock.on = false;
    expect(again).toMatchObject(NOT_FOUND);
    expect(metadata).toMatchObject(NOT_FOUND);
    expect(site.refusedReads).toHaveBeenCalledTimes(1);
    expect(clock.outside).toEqual([]);
  });
});

/** A page binding the site's name and its current year. */
const PAGE: BlockDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "name",
      type: "core/text",
      version: 1,
      props: { text: "" },
      bindings: { text: { $bind: "applicationName", source: "site" } },
    },
    {
      id: "year",
      type: "core/text",
      version: 1,
      props: { text: "" },
      bindings: { text: { $bind: "currentYear", source: "site" } },
    },
  ],
} as unknown as BlockDocument;

/** A site in the time zone `timezone`, holding one page. */
function siteIn(timezone: string | null) {
  const site: PublicSiteSettings = {
    applicationName: "Acme",
    siteUrl: null,
    logoUrl: null,
    timezone,
  };
  return {
    find: vi.fn(async (args: Record<string, unknown>) => ({
      items:
        args.collection === "pages"
          ? [{ id: "p1", slug: "about", title: "About", content: PAGE }]
          : [],
      meta: { total: 1, hasNext: false },
    })),
    findByID: vi.fn(async () => null),
    findSingle: vi.fn(async () => null),
    publicSiteSettings: vi.fn(async () => site),
    media: { findByID: vi.fn(async () => null) },
    // Its plugins, as an instance carries them, none offering forms: the
    // route reads the page's forms from them, not from the process's
    // instance, which this process never starts.
    plugins: {},
  };
}

async function html(element: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element, {
    onError(error) {
      throw error;
    },
  });
  await stream.allReady;
  return await new Response(stream).text();
}

/**
 * A cache of its own for one site, as each deployment has: the settings are
 * cached under one key, so two sites in one cache would share an answer.
 */
function freshCache(): void {
  registerCachedRead(cache.cachedRead, false);
  cache = useCache();
  registerCachedRead(cache.cachedRead, true);
}

/** The year the published page shows, and the page's markup. */
async function published(
  nextly: ReturnType<typeof siteIn>
): Promise<{ year: string | undefined; markup: string }> {
  const route = createPublicBlocksPage({
    collections: ["pages"],
    field: "content",
    blocks: createBlockResolver(coreBlocks),
    nextly: nextly as never,
    // Its own limit, so the route asks no registered instance for the site's.
    maxQueries: 20,
  });
  const element = await throughBoundary<PageRendererProps>(
    route.ContentPage({ params: { slug: ["about"] } })
  );
  const markup = await html(createElement(PageRenderer, element.props));
  const texts = [...markup.matchAll(/<p[^>]*>([^<]*)<\/p>/g)].map(m => m[1]);
  return { year: texts[1], markup };
}

/** The year the editor's canvas is handed, by the read its route makes. */
async function onTheCanvas(
  nextly: ReturnType<typeof siteIn>
): Promise<unknown> {
  const bindings = await readBindingSources({
    documents: [PAGE],
    entrySource: "collection",
    slug: "pages",
    entryId: "p1",
    page: "about",
    reader: { read: async () => null } as never,
    budget: createQueryBudget(20),
    siteSettings: nextly as never,
  });
  return (bindings?.site as Record<string, unknown> | undefined)?.currentYear;
}

describe("the site's current year", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is read from the clock only inside a cached read, so the page prerenders", async () => {
    const nextly = siteIn("Europe/Paris");
    const clock = watchClock();
    clock.on = true;
    const { year, markup } = await published(nextly);
    clock.on = false;
    expect(markup).toContain("Acme");
    expect(year).toBe(String(new Date().getUTCFullYear()));
    // The control: the year was worked out from the clock, inside the cache.
    expect(clock.inside).toBeGreaterThan(0);
    // This process has no Nextly instance started, so the structured-data
    // step's start of one fails here, and its error takes the time; a site's
    // started instance makes no such read. Every other read is the page's.
    expect(
      clock.outside.filter(stack => !stack.includes("startForProviders"))
    ).toEqual([]);
  });

  it("is the year in the site's time zone, not the server's, on 31 December", async () => {
    vi.useFakeTimers({
      now: new Date("2026-12-31T20:00:00Z"),
      toFake: ["Date"],
    });
    expect((await published(siteIn("Asia/Tokyo"))).year).toBe("2027");
    freshCache();
    expect((await published(siteIn("America/New_York"))).year).toBe("2026");
    freshCache();
    // A site with no zone is in UTC.
    expect((await published(siteIn(null))).year).toBe("2026");
  });

  it("is the same on the editor's canvas as on the published page", async () => {
    vi.useFakeTimers({
      now: new Date("2026-12-31T20:00:00Z"),
      toFake: ["Date"],
    });
    for (const zone of ["Asia/Tokyo", "America/New_York"]) {
      freshCache();
      const nextly = siteIn(zone);
      expect(await onTheCanvas(nextly)).toBe((await published(nextly)).year);
    }
  });
});
