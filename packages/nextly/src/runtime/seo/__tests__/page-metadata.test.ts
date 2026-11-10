/**
 * The route helpers' one way from a page to its head: ask the page-metadata
 * provider, then turn its answer into Next.js `Metadata`.
 *
 * What each case pins:
 * - with no provider, a route's own metadata is served exactly as before;
 * - with one, the provider is asked even when the route supplies nothing, and
 *   is told the title, description and social values the route's code set;
 * - visibility and the canonical come only from the answer: a route's own
 *   `robots` or canonical never reaches the head once a provider answers;
 * - what the answer does not cover (an Open Graph `type`, keywords) is kept;
 * - the answer is cached under the page's own tags plus the provider's, so a
 *   change to the provider's settings expires the page;
 * - a provider that fails costs the page its SEO answer, never the page.
 */
import type { Metadata } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recordCapabilityProviders } from "../../../plugins/capabilities";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import {
  clearPluginServices,
  registerPluginService,
} from "../../../plugins/services/plugin-services-registry";
import { metadataFromAnswer } from "../answer-metadata";
import type {
  PageMetadataAnswer,
  PageMetadataInput,
  PageMetadataResolver,
} from "../page-metadata-contract";

// What the cache was asked to do, observed at the call the route makes.
const cacheCalls: Array<{ keyParts: string[]; tags?: string[] }> = [];
vi.mock("../../cache/cached-find", () => ({
  cachedFind: <T>(
    reader: () => Promise<T>,
    options: { keyParts: string[]; tags?: string[] }
  ): Promise<T> => {
    cacheCalls.push(options);
    return reader();
  },
}));

const { pageMetadataFor } = await import("../page-metadata");

const PROVIDER = "@test/seo";

function provide(resolver: PageMetadataResolver): void {
  recordCapabilityProviders([
    {
      name: PROVIDER,
      version: "1.0.0",
      nextly: ">=0.0.0",
      provides: ["page-metadata"],
      contributes: { services: { pageMetadata: () => resolver } },
    } as PluginDefinition,
  ]);
  registerPluginService(PROVIDER, "pageMetadata", () => resolver);
}

const page = {
  path: "/about",
  locale: "en",
  source: {
    kind: "entry" as const,
    collection: "pages",
    entry: { id: "1", title: "About" },
  },
};

beforeEach(() => {
  cacheCalls.length = 0;
});

afterEach(() => {
  recordCapabilityProviders([]);
  clearPluginServices();
});

describe("metadataFromAnswer", () => {
  it("maps every value of the answer to its place in the head", () => {
    const answer: PageMetadataAnswer = {
      title: "About us",
      description: "Who we are.",
      canonical: "https://example.com/about",
      robots: { index: false, follow: true },
      social: {
        title: "About us, shared",
        description: "Shared text.",
        image: {
          url: "https://example.com/card.jpg",
          width: 1200,
          height: 630,
          alt: "Our team",
        },
        siteName: "Example",
        locale: "en_US",
        type: "website",
      },
      languages: { en: "/about", es: "/es/about" },
    };
    expect(metadataFromAnswer(answer)).toEqual({
      title: "About us",
      description: "Who we are.",
      alternates: {
        canonical: "https://example.com/about",
        languages: { en: "/about", es: "/es/about" },
      },
      robots: { index: false, follow: true },
      openGraph: {
        title: "About us, shared",
        description: "Shared text.",
        url: "https://example.com/about",
        images: [
          {
            url: "https://example.com/card.jpg",
            width: 1200,
            height: 630,
            alt: "Our team",
          },
        ],
        siteName: "Example",
        locale: "en_US",
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title: "About us, shared",
        description: "Shared text.",
        images: ["https://example.com/card.jpg"],
      },
    });
  });

  it("uses the page title and description on the card when the answer gives no social ones", () => {
    const metadata = metadataFromAnswer({ title: "T", description: "D" });
    expect(metadata.openGraph).toEqual({ title: "T", description: "D" });
    expect(metadata.twitter).toEqual({ title: "T", description: "D" });
  });

  it("leaves out everything the answer does not state", () => {
    expect(metadataFromAnswer({})).toEqual({});
  });
});

describe("pageMetadataFor with no provider", () => {
  it("serves the route's own metadata unchanged", async () => {
    const code: Metadata = {
      title: "Own",
      robots: { index: false, follow: false },
      alternates: { canonical: "/own" },
    };
    expect(await pageMetadataFor({ ...page, code, tags: ["t"] })).toBe(code);
  });

  it("serves nothing when the route supplies nothing", async () => {
    expect(
      await pageMetadataFor({ ...page, code: undefined, tags: [] })
    ).toEqual({});
  });
});

describe("pageMetadataFor with a provider", () => {
  it("asks the provider even when the route supplies no metadata", async () => {
    const seen: PageMetadataInput[] = [];
    provide({
      resolve: input => {
        seen.push(input);
        return { title: "From the provider" };
      },
    });
    const metadata = await pageMetadataFor({
      ...page,
      code: undefined,
      tags: [],
    });
    expect(metadata.title).toBe("From the provider");
    expect(seen).toEqual([
      {
        path: "/about",
        locale: "en",
        source: page.source,
        code: {},
        derived: {},
      },
    ]);
  });

  it("tells the provider the title, description and social values the route's code set", async () => {
    const seen: PageMetadataInput[] = [];
    provide({
      resolve: input => {
        seen.push(input);
        return {};
      },
    });
    await pageMetadataFor({
      ...page,
      derived: { title: "From the blocks" },
      code: {
        title: { absolute: "Code title" },
        description: "Code description",
        openGraph: {
          title: "Code card",
          description: "Code card text",
          images: [{ url: "/card.png", width: 1200, height: 630, alt: "A" }],
        },
      },
      tags: [],
    });
    expect(seen[0]?.code).toEqual({
      title: "Code title",
      description: "Code description",
      socialTitle: "Code card",
      socialDescription: "Code card text",
      image: { url: "/card.png", width: 1200, height: 630, alt: "A" },
    });
    expect(seen[0]?.derived).toEqual({ title: "From the blocks" });
  });

  it("never lets the route's own visibility or canonical reach the head", async () => {
    provide({ resolve: () => ({ title: "Answered" }) });
    const metadata = await pageMetadataFor({
      ...page,
      code: {
        robots: { index: false, follow: false },
        alternates: { canonical: "https://elsewhere.example/x" },
      },
      tags: [],
    });
    expect(metadata.robots).toBeUndefined();
    expect(metadata.alternates?.canonical).toBeUndefined();
  });

  it("keeps what the answer does not cover, and the answer's values win", async () => {
    provide({
      resolve: () => ({
        title: "Answered",
        social: { title: "Answered card" },
      }),
    });
    const metadata = await pageMetadataFor({
      ...page,
      code: {
        title: "Code title",
        keywords: ["kept"],
        openGraph: { type: "article", title: "Code card" },
      },
      tags: [],
    });
    expect(metadata.title).toBe("Answered");
    expect(metadata.keywords).toEqual(["kept"]);
    expect(metadata.openGraph).toMatchObject({
      type: "article",
      title: "Answered card",
    });
  });

  it("caches the answer under the page's tags and the provider's", async () => {
    provide({
      resolve: () => ({ title: "Answered" }),
      tags: () => ["nextly:plugin:@test/seo:settings"],
    });
    await pageMetadataFor({ ...page, code: undefined, tags: ["page-tag"] });
    expect(cacheCalls).toHaveLength(1);
    expect(cacheCalls[0]?.tags).toEqual([
      "page-tag",
      "nextly:plugin:@test/seo:settings",
    ]);
  });

  it("keys the cached answer by everything it was asked, so a different page or draft is a different entry", async () => {
    provide({ resolve: () => ({}) });
    await pageMetadataFor({ ...page, code: undefined, tags: [] });
    await pageMetadataFor({
      ...page,
      source: {
        ...page.source,
        entry: { id: "1", title: "About, unpublished edit" },
      },
      code: undefined,
      tags: [],
    });
    await pageMetadataFor({ ...page, code: undefined, tags: [] });
    const keys = cacheCalls.map(call => call.keyParts.join("|"));
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toBe(keys[2]);
  });

  it("serves the route's own metadata when the provider fails", async () => {
    provide({
      resolve: () => {
        throw new Error("settings unreadable");
      },
    });
    const code: Metadata = { title: "Own" };
    expect(await pageMetadataFor({ ...page, code, tags: [] })).toEqual(code);
  });
});
