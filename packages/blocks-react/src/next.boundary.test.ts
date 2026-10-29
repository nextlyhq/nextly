/**
 * Under Cache Components, each blocks page factory answers a Suspense boundary
 * before it reads anything, and the read happens in the body beneath it. That
 * is what lets a page prerender as a static shell: the draft gate's cookie, an
 * enforced read and an unlisted param are all request-time work, and Next.js
 * refuses to prerender any of them above a boundary.
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
    it.each([
      ["enforced", createSinglePage],
      ["public", createPublicSinglePage],
    ] as const)(
      "(%s) reads the Single beneath its boundary",
      async (_, factory) => {
        const reader = recordingReader();
        const route = factory({
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
      }
    );

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
    it.each([
      ["enforced", createBlocksPage],
      ["public", createPublicBlocksPage],
    ] as const)(
      "(%s) awaits its params and reads beneath its boundary",
      async (_, factory) => {
        const reader = recordingReader();
        const route = factory({
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
      }
    );
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
