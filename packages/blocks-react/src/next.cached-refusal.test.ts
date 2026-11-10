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
 * Driven through the real route, the real reader and the real `cachedFind`,
 * with only the Direct API, the address store and the cache below them faked.
 */
import { AsyncLocalStorage } from "node:async_hooks";

import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { NextlyError } from "nextly/errors";
import { registerCachedRead, runRegisteredRead } from "nextly/runtime";
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
import { createPublicContentPage, type ContentPageConfig } from "./next";
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

/**
 * The app's `"use cache"` function, as Next.js runs it: a miss runs the read
 * and keeps a copy of its answer under the key, a throw keeps nothing, and a
 * hit hands back a copy without running anything.
 */
function useCache() {
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
function watchClock() {
  const RealDate = Date;
  const clock = { on: false, outside: [] as string[], inside: 0 };
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
    const metadata = await route.generateMetadata({ params: { slug } });
    clock.on = false;
    expect(again).toMatchObject(NOT_FOUND);
    expect(metadata).toEqual({});
    expect(site.refusedReads).toHaveBeenCalledTimes(1);
    expect(clock.outside).toEqual([]);
  });
});
