/**
 * Under Cache Components, each ACCESS-ENFORCED blocks page factory answers a
 * Suspense boundary before it reads anything, and the read happens in the body
 * beneath it. That is what lets such a page prerender as a static shell: the
 * draft gate's cookie, an enforced read and an unlisted param are all
 * request-time work, and Next.js refuses to prerender any of them above a
 * boundary.
 *
 * The PUBLIC factories answer their page with no boundary, Cache Components on
 * or off, so a build makes the whole page and its HTML holds it: React sends a
 * boundary's finished content in a hidden part that only its script reveals
 * (`next.html-without-javascript.test.tsx`). They read before the page
 * returns, and a missing entry rejects the page itself, for a 404.
 *
 * Without Cache Components there is no boundary: the page reads before it
 * returns, so a missing entry's `notFound()` rejects the page itself and the
 * App Router can answer it with a 404 rather than a streamed not-found page.
 *
 * Observed through the reads themselves: the reader, the draft hook and the
 * slug inside the route's `params` each record being used. Each case checks
 * that none was used when the boundary came back, then that the body used it.
 */
import { Suspense, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { throughBoundary } from "./__tests__/through-boundary";
import { coreBlocks } from "./blocks";
import {
  createBlocksPage,
  createPublicBlocksPage,
  createPublicSinglePage,
  createSinglePage,
} from "./next";
import { createBlockResolver } from "./resolver";

/** A reader that serves one page and records every read. */
function recordingReader() {
  const document = { slug: "about", title: "About", content: null };
  return {
    findSingle: vi.fn(async () => document),
    find: vi.fn(async () => ({
      items: [document],
      meta: { hasNext: false },
    })),
    findByID: vi.fn(async () => null),
    media: { findByID: vi.fn(async () => null) },
  };
}

/** Every read the reader recorded. */
function readsOf(reader: ReturnType<typeof recordingReader>): number {
  return (
    reader.findSingle.mock.calls.length +
    reader.find.mock.calls.length +
    reader.findByID.mock.calls.length
  );
}

/**
 * Route `params` that record when the page reads the slug out of them, which
 * it does as soon as it has awaited them.
 */
function watchedParams(slug: string[]) {
  const watched = { read: false };
  const params = Promise.resolve({
    get slug() {
      watched.read = true;
      return slug;
    },
  });
  return { params, watched };
}

const blocks = createBlockResolver(coreBlocks);

describe("under Cache Components", () => {
  beforeEach(() => {
    vi.stubEnv("__NEXT_CACHE_COMPONENTS", "true");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("a Single blocks page", () => {
    it("(enforced) reads the Single beneath its boundary", async () => {
      const reader = recordingReader();
      const route = createSinglePage({
        slug: "homepage",
        field: "content",
        blocks,
        nextly: reader as never,
      });

      const page = route.SinglePage();
      const boundary = (await page) as ReactElement;

      expect(boundary.type).toBe(Suspense);
      expect(readsOf(reader)).toBe(0);
      await throughBoundary(Promise.resolve(boundary));
      expect(reader.findSingle).toHaveBeenCalledTimes(1);
    });

    it("(public) reads the Single before the page returns, with no boundary", async () => {
      const reader = recordingReader();
      const route = createPublicSinglePage({
        slug: "homepage",
        field: "content",
        blocks,
        nextly: reader as never,
      });

      const page = (await route.SinglePage()) as ReactElement;

      expect(page.type).not.toBe(Suspense);
      expect(reader.findSingle).toHaveBeenCalledTimes(1);
    });

    it("(public) answers a missing Single with the site's own handler beneath a boundary", async () => {
      const handler = vi.fn(async (): Promise<never> => {
        throw NOT_FOUND;
      });
      const route = createPublicSinglePage({
        slug: "homepage",
        field: "content",
        blocks,
        nextly: emptyReader() as never,
        notFound: handler,
      });

      const answer = (await route.SinglePage()) as ReactElement;

      expect(answer.type).toBe(Suspense);
      expect(handler).not.toHaveBeenCalled();
      await expect(
        throughBoundary(Promise.resolve(answer))
      ).rejects.toMatchObject(NOT_FOUND);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("hands its params to the page beneath the boundary, so a [locale] segment is read", async () => {
      const reader = recordingReader();
      const route = createSinglePage({
        slug: "homepage",
        field: "content",
        blocks,
        nextly: reader as never,
      });
      const watched = { read: false };
      const params = Promise.resolve({
        get locale() {
          watched.read = true;
          return "de";
        },
      });

      const boundary = await route.SinglePage({ params });

      expect(watched.read).toBe(false);
      // No site is running here, so the language is one it does not have:
      // the body answers not found, having read the segment.
      await throughBoundary(Promise.resolve(boundary)).catch(() => undefined);
      expect(watched.read).toBe(true);
    });

    it("asks its draft gate beneath the boundary", async () => {
      const reader = recordingReader();
      const draft = vi.fn(() => false);
      const route = createSinglePage({
        slug: "homepage",
        field: "content",
        blocks,
        nextly: reader as never,
        draft,
      });

      const boundary = await route.SinglePage();

      expect(draft).not.toHaveBeenCalled();
      await throughBoundary(Promise.resolve(boundary));
      expect(draft).toHaveBeenCalledTimes(1);
    });
  });

  describe("a content blocks page", () => {
    it("(enforced) awaits its params and reads beneath its boundary", async () => {
      const reader = recordingReader();
      const route = createBlocksPage({
        collections: ["pages"],
        field: "content",
        blocks,
        nextly: reader as never,
      });
      const { params, watched } = watchedParams(["about"]);

      const boundary = await route.ContentPage({ params });

      expect(watched.read).toBe(false);
      expect(readsOf(reader)).toBe(0);
      await throughBoundary(Promise.resolve(boundary));
      expect(watched.read).toBe(true);
      expect(reader.find).toHaveBeenCalled();
    });

    it("(public) awaits its params and reads before the page returns, with no boundary", async () => {
      const reader = recordingReader();
      const route = createPublicBlocksPage({
        collections: ["pages"],
        field: "content",
        blocks,
        nextly: reader as never,
      });
      const { params, watched } = watchedParams(["about"]);

      const page = (await route.ContentPage({ params })) as ReactElement;

      expect(page.type).not.toBe(Suspense);
      expect(watched.read).toBe(true);
      expect(reader.find).toHaveBeenCalled();
    });

    it("(public) answers a miss with the site's own handler beneath a boundary, and a found page with none", async () => {
      // The site's handler may read the request, which a build refuses above
      // a boundary, and a public route builds a path holding nothing while no
      // page is published. So only that miss is answered beneath one.
      const handler = vi.fn(async (): Promise<never> => {
        throw NOT_FOUND;
      });
      const missing = createPublicBlocksPage({
        collections: ["pages"],
        field: "content",
        blocks,
        nextly: emptyReader() as never,
        notFound: handler,
      });

      const answer = (await missing.ContentPage({
        params: Promise.resolve({ slug: ["missing"] }),
      })) as ReactElement;

      expect(answer.type).toBe(Suspense);
      expect(handler).not.toHaveBeenCalled();
      await expect(
        throughBoundary(Promise.resolve(answer))
      ).rejects.toMatchObject(NOT_FOUND);
      expect(handler).toHaveBeenCalledTimes(1);

      const found = createPublicBlocksPage({
        collections: ["pages"],
        field: "content",
        blocks,
        nextly: recordingReader() as never,
        notFound: handler,
      });
      const page = (await found.ContentPage({
        params: Promise.resolve({ slug: ["about"] }),
      })) as ReactElement;
      expect(page.type).not.toBe(Suspense);
    });

    it("(public) asks the site's own handler for a miss in its head, outside any boundary", async () => {
      const handler = vi.fn(async (): Promise<never> => {
        throw NOT_FOUND;
      });
      const route = createPublicBlocksPage({
        collections: ["pages"],
        field: "content",
        blocks,
        nextly: emptyReader() as never,
        notFound: handler,
      });

      await expect(
        route.generateMetadata({
          params: Promise.resolve({ slug: ["missing"] }),
        })
      ).rejects.toMatchObject(NOT_FOUND);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("(public) rejects with not found for a missing entry, for a 404", async () => {
      const route = createPublicBlocksPage({
        collections: ["pages"],
        field: "content",
        blocks,
        nextly: emptyReader() as never,
      });

      await expect(
        route.ContentPage({ params: Promise.resolve({ slug: ["missing"] }) })
      ).rejects.toMatchObject(NOT_FOUND);
    });
  });
});

/** A reader that finds nothing, so the route answers not found. */
function emptyReader() {
  return {
    findSingle: vi.fn(async () => null),
    find: vi.fn(async () => ({ items: [], meta: { hasNext: false } })),
    findByID: vi.fn(async () => null),
    media: { findByID: vi.fn(async () => null) },
  };
}

/** What Next.js's `notFound()` throws, for the App Router to answer 404. */
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

describe("without Cache Components", () => {
  // The default for every app today. A boundary here would let the shell
  // stream before the read, so a missing entry would answer 200 with the
  // not-found page; each page is the route's own instead.
  beforeEach(() => {
    vi.stubEnv("__NEXT_CACHE_COMPONENTS", "false");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["enforced", createSinglePage],
    ["public", createPublicSinglePage],
  ] as const)(
    "(%s) reads the Single before the page returns",
    async (_, factory) => {
      const reader = recordingReader();
      const route = factory({
        slug: "homepage",
        field: "content",
        blocks,
        nextly: reader as never,
      });

      const page = (await route.SinglePage()) as ReactElement;

      expect(page.type).not.toBe(Suspense);
      expect(reader.findSingle).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    ["enforced", createBlocksPage],
    ["public", createPublicBlocksPage],
  ] as const)(
    "(%s) rejects with not found for a missing entry, with no boundary to stream first",
    async (_, factory) => {
      const route = factory({
        collections: ["pages"],
        field: "content",
        blocks,
        nextly: emptyReader() as never,
      });

      await expect(
        route.ContentPage({ params: Promise.resolve({ slug: ["missing"] }) })
      ).rejects.toMatchObject(NOT_FOUND);
    }
  );

  it("leaves a public page's miss to notFound() itself, with no boundary, whatever handler the site passed", async () => {
    // Without Cache Components a public page is rendered once and kept, so
    // the site's handler, which may read the request, is not called.
    const handler = vi.fn(async (): Promise<never> => {
      throw new Error("the site's handler ran");
    });
    const route = createPublicBlocksPage({
      collections: ["pages"],
      field: "content",
      blocks,
      nextly: emptyReader() as never,
      notFound: handler,
    });

    await expect(
      route.ContentPage({ params: Promise.resolve({ slug: ["missing"] }) })
    ).rejects.toMatchObject(NOT_FOUND);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects with not found for a missing Single", async () => {
    const route = createSinglePage({
      slug: "homepage",
      field: "content",
      blocks,
      nextly: emptyReader() as never,
    });

    await expect(route.SinglePage()).rejects.toMatchObject(NOT_FOUND);
  });
});
