/**
 * A public route's image reads: made inside the cache the route's other reads
 * use, tagged as a media write expires them, and a missing image kept as no
 * picture rather than thrown.
 *
 * Under Cache Components a prerender refuses an uncached read that takes the
 * current time, and the media library's answer to a missing id takes it: it
 * builds its not-found error, whose constructor records when it was made,
 * before `disableErrors` turns it into `null`. So the property that separates
 * a correct route from the broken one is WHERE that miss is built, inside a
 * cached read or outside every one, which no rendered output shows. The
 * double below builds the same error the library does, and records whether
 * it was built inside a cached read.
 *
 * Driven through the real route with only the Direct API below it faked.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { NextlyError } from "nextly/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Each cached read's key and tags, and whether the caller runs inside one.
// `store`, when set, answers a cached read from what it kept under the same
// key, as Next's cache does: an answer is kept, a throw is not.
const runtime = vi.hoisted(() => ({
  reads: [] as { keyParts: string[]; tags: string[] }[],
  isCached: (): boolean => false,
  store: null as Map<string, unknown> | null,
}));
vi.mock("nextly/runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("nextly/runtime")>();
  const { AsyncLocalStorage } = await import("node:async_hooks");
  const inCache = new AsyncLocalStorage<true>();
  runtime.isCached = () => inCache.getStore() === true;
  return {
    ...actual,
    createPublicReader: (
      ...[source, binding]: Parameters<typeof actual.createPublicReader>
    ) =>
      actual.createPublicReader(source, {
        ...binding,
        declarations: { hiddenFields: () => [] },
      }),
    cachedFind: async (
      read: () => Promise<unknown>,
      options: Parameters<typeof actual.cachedFind>[1]
    ) => {
      runtime.reads.push({
        keyParts: [...options.keyParts],
        tags: [...options.tags],
      });
      const inside = () => inCache.run(true, read);
      const store = runtime.store;
      if (store === null) return await actual.cachedFind(inside, options);
      const key = JSON.stringify(options.keyParts);
      if (store.has(key)) return store.get(key);
      const value = await inside();
      store.set(key, value);
      return value;
    },
  };
});

import { coreBlocks } from "./blocks";
import { createBlocksPage, createPublicBlocksPage } from "./next";
import type { DerivedPageSeo } from "./next";
import { createBlockResolver } from "./resolver";

const MISSING = "55555555-5555-4555-8555-555555555555";
const REFUSED = "66666666-6666-4666-8666-666666666666";
const PRESENT = "77777777-7777-4777-8777-777777777777";

/** A page whose only image names `mediaId`, with no address of its own. */
function pageWithImage(mediaId: string): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "1",
        type: "core/image",
        version: 1,
        props: { mediaId },
      },
    ],
  };
}

/**
 * A Direct API answering one page, and a media library answering `PRESENT`.
 * `MISSING` is answered as the library answers a missing id, and `REFUSED`
 * with a refusal whatever the call asks.
 */
function instance(content: BlockDocument) {
  /** The ids whose not-found error was built outside every cached read. */
  const builtOutsideCache: string[] = [];
  const findByID = vi.fn(
    async ({ id, disableErrors }: { id: string; disableErrors?: boolean }) => {
      if (id === PRESENT) {
        return { id, url: "https://cdn.example/present.png" };
      }
      if (id === REFUSED) throw NextlyError.forbidden();
      // As `MediaService.findById` answers a miss: the error is built first,
      // and taking the time is part of building it.
      if (!runtime.isCached()) builtOutsideCache.push(id);
      const miss = NextlyError.notFound();
      if (disableErrors === true) return null;
      throw miss;
    }
  );
  return {
    builtOutsideCache,
    nextly: {
      find: vi.fn(async () => ({
        items: [{ id: "p1", slug: "about", content }],
        meta: { total: 1 },
      })),
      findByID: vi.fn(async () => null),
      publicSiteSettings: vi.fn(async () => ({
        siteName: "Site",
        timezone: "UTC",
      })),
      media: { findByID },
    },
  };
}

/** The route's metadata for `/about`, and what it derived from the page. */
async function metadataOf(
  build: typeof createPublicBlocksPage | typeof createBlocksPage,
  nextly: ReturnType<typeof instance>["nextly"],
  extra: { cacheScope?: string } = {}
) {
  let derived: DerivedPageSeo | undefined;
  const route = build({
    collections: ["pages"],
    field: "content",
    blocks: createBlockResolver(coreBlocks),
    nextly: nextly as never,
    ...extra,
    metadata: (_entry, _context, seo) => {
      derived = seo;
      return {
        title: "About",
        ...(seo.image === undefined
          ? {}
          : { openGraph: { images: [seo.image] } }),
      };
    },
  });
  const metadata = await route.generateMetadata({
    params: { slug: ["about"] },
  });
  return { metadata, derived };
}

/** The cached image reads the route made, by their key's first part. */
function mediaReads() {
  return runtime.reads.filter(read => read.keyParts[0] === "nextly-media");
}

beforeEach(() => {
  runtime.reads = [];
  runtime.store = null;
});

describe("a public route's image reads", () => {
  it("answers a missing media id as no preview image, building the miss inside the cache", async () => {
    const site = instance(pageWithImage(MISSING));

    const { metadata, derived } = await metadataOf(
      createPublicBlocksPage,
      site.nextly
    );

    expect(metadata).toEqual({ title: "About" });
    expect(derived?.image).toBeUndefined();
    // The control: the library was asked for the missing id, so the miss was
    // built at all, and an empty list below is not an empty list by absence.
    expect(site.nextly.media.findByID).toHaveBeenCalledWith({
      id: MISSING,
      disableErrors: true,
    });
    expect(site.builtOutsideCache).toEqual([]);
  });

  it("tags an image's read with the media collection and its id, which a media write expires", async () => {
    const site = instance(pageWithImage(PRESENT));

    const { derived } = await metadataOf(createPublicBlocksPage, site.nextly, {
      cacheScope: "site-a",
    });

    expect(derived?.image).toBe("https://cdn.example/present.png");
    const reads = mediaReads();
    expect(reads).toHaveLength(1);
    // The tags a media write expires (`revalidateMedia` in nextly): the
    // collection's, and the written file's own.
    expect(reads[0]!.tags).toEqual([
      "nextly:media",
      `nextly:media:id:${PRESENT}`,
    ]);
    // Under the route's scope, so two sites over different databases asking
    // for one id never share the answer.
    expect(reads[0]!.keyParts).toContain("site-a");
    expect(reads[0]!.keyParts).toContain(PRESENT);
  });

  it("keeps a missing image as a miss, so the page's next metadata reads nothing for it", async () => {
    runtime.store = new Map();
    const site = instance(pageWithImage(MISSING));

    await metadataOf(createPublicBlocksPage, site.nextly);
    const second = await metadataOf(createPublicBlocksPage, site.nextly);

    expect(second.derived?.image).toBeUndefined();
    expect(site.nextly.media.findByID).toHaveBeenCalledTimes(1);
  });

  it("keeps a refused image as no picture rather than as the refusal", async () => {
    // `cachedFind` keeps a refusal as one and throws it again on every hit,
    // outside the cache, where building that error takes the time too.
    runtime.store = new Map();
    const site = instance(pageWithImage(REFUSED));

    const { metadata } = await metadataOf(createPublicBlocksPage, site.nextly);

    expect(metadata).toEqual({ title: "About" });
    // The control: the refused read was made, through the cache.
    expect(site.nextly.media.findByID).toHaveBeenCalledWith({
      id: REFUSED,
      disableErrors: true,
    });
    const kept = mediaReads().map(read =>
      runtime.store?.get(JSON.stringify(read.keyParts))
    );
    expect(kept).toEqual([null]);
  });

  it("is per request on an access-enforced route, which caches none of its reads", async () => {
    const site = instance(pageWithImage(PRESENT));

    const { derived } = await metadataOf(createBlocksPage, site.nextly);

    expect(derived?.image).toBe("https://cdn.example/present.png");
    expect(site.nextly.media.findByID).toHaveBeenCalled();
    expect(mediaReads()).toEqual([]);
  });
});
