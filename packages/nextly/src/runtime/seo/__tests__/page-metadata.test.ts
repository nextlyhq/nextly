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
 * - a provider that fails costs the page its SEO answer, never the page;
 * - the page's structured data is read from the same cached answer as its
 *   head, and an answer whose structured data is not JSON-LD is refused whole;
 * - the answer's title is served whole, past a layout's title template,
 *   unless it is the route's own title, which is served as the route gave it;
 * - the route may hide a page, never show one, and the preview limits it
 *   gives search engines are kept;
 * - a page the answer gives no canonical keeps the route's own;
 * - a worker where nothing has started Nextly yet starts it before asking,
 *   rather than serving the route's own head.
 */
import type { Metadata } from "next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  forgetCapabilityProviders,
  recordCapabilityProviders,
} from "../../../plugins/capabilities";
import type { PluginDefinition } from "../../../plugins/plugin-context";
import {
  clearPluginServices,
  registerPluginService,
} from "../../../plugins/services/plugin-services-registry";
import { consoleLogger } from "../../../shared/types";
import { metadataFromAnswer } from "../answer-metadata";
import type {
  PageMetadataAnswer,
  PageMetadataInput,
  PageMetadataResolver,
} from "../page-metadata-contract";

// What the cache was asked to do, observed at the call the route makes.
const cacheCalls: Array<{ keyParts: string[]; tags?: string[] }> = [];
/** What each cached read came to: the value a cache would store, or a refusal. */
const cacheOutcomes: Array<{ stored: unknown } | { refused: true }> = [];
vi.mock("../../cache/cached-find", () => ({
  cachedFind: async <T>(
    reader: () => Promise<T>,
    options: { keyParts: string[]; tags?: string[] }
  ): Promise<T> => {
    cacheCalls.push(options);
    try {
      const value = await reader();
      cacheOutcomes.push({ stored: value });
      return value;
    } catch (error) {
      cacheOutcomes.push({ refused: true });
      throw error;
    }
  },
}));

// Nextly's start in this process, stood in for: what it does when asked (a
// boot records the providers), how often it was asked, and whether it fails.
const start = vi.hoisted(() => ({
  boot: undefined as (() => void) | undefined,
  calls: 0,
  fails: false,
}));
vi.mock("../../../init", () => ({
  getCachedNextly: async () => {
    start.calls += 1;
    if (start.fails) throw new Error("the database is unreachable");
    start.boot?.();
    return {};
  },
}));

const { pageMetadataFor, pageStructuredDataFor } = await import(
  "../page-metadata"
);

const PROVIDER = "@test/seo";

function provide(
  resolver: PageMetadataResolver,
  name = PROVIDER,
  version = "1.0.0"
): void {
  clearPluginServices();
  recordCapabilityProviders([
    {
      name,
      version,
      nextly: ">=0.0.0",
      provides: ["page-metadata"],
      contributes: { services: { pageMetadata: () => resolver } },
    } as PluginDefinition,
  ]);
  registerPluginService(name, "pageMetadata", () => resolver);
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
  cacheOutcomes.length = 0;
  start.boot = undefined;
  start.calls = 0;
  start.fails = false;
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
        // The image's alt text reaches the large-image card too, which
        // reads its own `twitter:image:alt` rather than Open Graph's.
        images: [{ url: "https://example.com/card.jpg", alt: "Our team" }],
      },
    });
  });

  it("names a card image with no alt text by its address alone", () => {
    const metadata = metadataFromAnswer({
      social: { image: { url: "https://example.com/card.jpg" } },
    });
    expect(metadata.twitter).toEqual({
      card: "summary_large_image",
      images: ["https://example.com/card.jpg"],
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
    expect(metadata.title).toEqual({ absolute: "From the provider" });
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

  it("never lets the route's own canonical or visibility override the answer's", async () => {
    provide({
      resolve: () => ({
        title: "Answered",
        canonical: "https://example.com/about",
        robots: { index: true, follow: true },
      }),
    });
    const metadata = await pageMetadataFor({
      ...page,
      code: {
        robots: { index: true, follow: true },
        alternates: { canonical: "https://elsewhere.example/x" },
        openGraph: { url: "https://elsewhere.example/x" },
      },
      tags: [],
    });
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.alternates?.canonical).toBe("https://example.com/about");
    expect(metadata.openGraph?.url).toBe("https://example.com/about");
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
    expect(metadata.title).toEqual({ absolute: "Answered" });
    expect(metadata.keywords).toEqual(["kept"]);
    expect(metadata.openGraph).toMatchObject({
      type: "article",
      title: { absolute: "Answered card" },
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

  it("keys the cached answer by its provider and version, so a replaced provider never reads another's answer", async () => {
    provide({ resolve: () => ({ title: "First" }) });
    await pageMetadataFor({ ...page, code: undefined, tags: [] });
    provide({ resolve: () => ({ title: "Second" }) }, "@other/seo");
    await pageMetadataFor({ ...page, code: undefined, tags: [] });
    provide({ resolve: () => ({ title: "Upgraded" }) }, PROVIDER, "2.0.0");
    await pageMetadataFor({ ...page, code: undefined, tags: [] });
    const keys = cacheCalls.map(call => call.keyParts.join("|"));
    expect(new Set(keys).size).toBe(3);
  });

  it.each([
    ["nothing", null],
    ["a title that is not text", { title: 5 }],
    ["visibility without its values", { robots: { index: "no" } }],
    ["structured data that is not a list of nodes", { structuredData: "x" }],
    ["a structured data node that is text", { structuredData: ["WebPage"] }],
    [
      "structured data holding a function",
      { structuredData: [{ "@type": "Thing", name: () => "x" }] },
    ],
  ])(
    "serves the route's own metadata for an answer of %s, and caches none of it",
    async (_, answer) => {
      provide({ resolve: () => answer as never });
      const code: Metadata = { title: "Own" };
      expect(await pageMetadataFor({ ...page, code, tags: [] })).toEqual(code);
      // Refused inside the cached read, so the next request asks again.
      expect(cacheOutcomes).toEqual([{ refused: true }]);
    }
  );

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

describe("pageStructuredDataFor", () => {
  const nodes = [
    { "@type": "WebPage", "@id": "https://example.com/about", name: "About" },
  ];

  it("is nothing with no provider, and asks nothing", async () => {
    recordCapabilityProviders([]);
    expect(
      await pageStructuredDataFor({ ...page, code: undefined, tags: [] })
    ).toBeUndefined();
    expect(cacheCalls).toHaveLength(0);
  });

  it("is the structured data of the same answer the head is built from", async () => {
    let asked = 0;
    provide({
      resolve: () => {
        asked += 1;
        return { title: "About us", structuredData: nodes };
      },
    });
    const request = { ...page, code: { title: "Own" }, tags: ["pages"] };

    const head = await pageMetadataFor(request);
    const text = await pageStructuredDataFor(request);

    // The head is what it would be without it: structured data is the page's.
    expect(head).toEqual({
      title: { absolute: "About us" },
      openGraph: { title: { absolute: "About us" } },
      twitter: { title: { absolute: "About us" } },
    });
    expect(JSON.parse(text ?? "")).toEqual({
      "@context": "https://schema.org",
      "@graph": nodes,
    });
    // One answer: the same cache entry, asked with the same input.
    expect(asked).toBe(2);
    expect(cacheCalls[0]?.keyParts).toEqual(cacheCalls[1]?.keyParts);
    expect(cacheCalls[0]?.tags).toEqual(cacheCalls[1]?.tags);
  });

  it("is nothing when the answer has no structured data", async () => {
    provide({ resolve: () => ({ title: "About us" }) });
    expect(
      await pageStructuredDataFor({ ...page, code: undefined, tags: [] })
    ).toBeUndefined();
  });

  it("is nothing, never a failed page, when the provider fails", async () => {
    provide({
      resolve: () => {
        throw new Error("settings unreadable");
      },
    });
    expect(
      await pageStructuredDataFor({ ...page, code: undefined, tags: [] })
    ).toBeUndefined();
  });

  it("is nothing for an answer whose structured data is refused", async () => {
    provide({
      resolve: () => ({ structuredData: [{ name: () => "x" }] }) as never,
    });
    expect(
      await pageStructuredDataFor({ ...page, code: undefined, tags: [] })
    ).toBeUndefined();
    expect(cacheOutcomes).toEqual([{ refused: true }]);
  });
});

describe("the answer's title", () => {
  it("is served whole, so a layout's title template cannot add the site name again", async () => {
    provide({ resolve: () => ({ title: "Pricing | Example" }) });
    const metadata = await pageMetadataFor({
      ...page,
      code: undefined,
      tags: [],
    });
    expect(metadata.title).toEqual({ absolute: "Pricing | Example" });
  });

  it("is whole over a route title that differs from it, such as one typed for the page", async () => {
    provide({ resolve: () => ({ title: "Typed title | Example" }) });
    const metadata = await pageMetadataFor({
      ...page,
      code: { title: "Code title" },
      tags: [],
    });
    expect(metadata.title).toEqual({ absolute: "Typed title | Example" });
  });

  it("is served as the route gave it where it is the route's own title", async () => {
    // Without a provider a layout's template applies to the route's text,
    // and the route's own title keeps that: it is not made whole for it.
    provide({ resolve: input => ({ title: input.code.title }) });
    const plain = await pageMetadataFor({
      ...page,
      code: { title: "Pricing" },
      tags: [],
    });
    expect(plain.title).toBe("Pricing");
    const whole = await pageMetadataFor({
      ...page,
      code: { title: { absolute: "Pricing | Example" } },
      tags: [],
    });
    expect(whole.title).toEqual({ absolute: "Pricing | Example" });
  });
});

describe("the answer's social card titles", () => {
  it("are served whole too, past a layout's card title template, unless they are the route's own", async () => {
    provide({
      resolve: () => ({
        title: "Pricing | Example",
        social: { title: "Code card" },
      }),
    });
    const metadata = await pageMetadataFor({
      ...page,
      code: { openGraph: { title: "Code card" } },
      tags: [],
    });
    expect(metadata.openGraph?.title).toBe("Code card");
    expect(metadata.twitter?.title).toEqual({ absolute: "Code card" });
  });
});

describe("the route's own robots", () => {
  it("tells the provider the route hides the page", async () => {
    const seen: PageMetadataInput[] = [];
    provide({
      resolve: input => {
        seen.push(input);
        return { robots: { index: true, follow: true } };
      },
    });
    await pageMetadataFor({
      ...page,
      code: { robots: { index: false, follow: true } },
      tags: [],
    });
    await pageMetadataFor({
      ...page,
      code: { robots: "noindex, follow" },
      tags: [],
    });
    await pageMetadataFor({
      ...page,
      code: { robots: { index: true, follow: true } },
      tags: [],
    });
    expect(seen.map(input => input.code.hidden)).toEqual([
      true,
      true,
      undefined,
    ]);
  });

  it("keeps a page the route hides hidden, whatever the answer says", async () => {
    provide({ resolve: () => ({ robots: { index: true, follow: true } }) });
    const object = await pageMetadataFor({
      ...page,
      code: { robots: { index: false, follow: false } },
      tags: [],
    });
    expect(object.robots).toEqual({ index: false, follow: false });
    const text = await pageMetadataFor({
      ...page,
      code: { robots: "noindex, nofollow" },
      tags: [],
    });
    expect(text.robots).toEqual({ index: false, follow: false });
    const none = await pageMetadataFor({
      ...page,
      code: { robots: "none" },
      tags: [],
    });
    expect(none.robots).toEqual({ index: false, follow: false });
  });

  it("hides a page the answer hides, though the route lists it", async () => {
    provide({ resolve: () => ({ robots: { index: false, follow: true } }) });
    const metadata = await pageMetadataFor({
      ...page,
      code: { robots: { index: true, follow: true } },
      tags: [],
    });
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });

  it("keeps the preview limits and other directives the route gives search engines", async () => {
    provide({ resolve: () => ({ robots: { index: false, follow: true } }) });
    const metadata = await pageMetadataFor({
      ...page,
      code: {
        robots: {
          index: true,
          follow: true,
          "max-image-preview": "large",
          "max-snippet": -1,
          googleBot: {
            index: true,
            follow: true,
            "max-video-preview": -1,
            "max-image-preview": "large",
          },
        },
      },
      tags: [],
    });
    expect(metadata.robots).toEqual({
      index: false,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      googleBot: {
        index: false,
        follow: true,
        "max-video-preview": -1,
        "max-image-preview": "large",
      },
    });
  });

  it("reads the directives of robots given as text", async () => {
    provide({ resolve: () => ({ robots: { index: true, follow: true } }) });
    const metadata = await pageMetadataFor({
      ...page,
      code: {
        robots:
          "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:30, noarchive",
      },
      tags: [],
    });
    expect(metadata.robots).toEqual({
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": 30,
      noarchive: true,
    });
  });

  it("keeps Googlebot's own stricter rule for the page", async () => {
    provide({ resolve: () => ({ robots: { index: true, follow: true } }) });
    const metadata = await pageMetadataFor({
      ...page,
      code: { robots: { googleBot: "noindex" } },
      tags: [],
    });
    expect(metadata.robots).toEqual({
      index: true,
      follow: true,
      googleBot: { index: false, follow: true },
    });
  });
});

describe("the answer's display controls", () => {
  it("places each control in the head as Google spells it", () => {
    const metadata = metadataFromAnswer({
      robots: {
        index: true,
        follow: true,
        maxImagePreview: "standard",
        maxSnippet: 80,
        nosnippet: true,
        noimageindex: true,
        unavailableAfter: "2026-12-31T23:59:00.000Z",
        noarchive: true,
        nocache: true,
      },
    });
    expect(metadata.robots).toEqual({
      index: true,
      follow: true,
      "max-image-preview": "standard",
      "max-snippet": 80,
      nosnippet: true,
      noimageindex: true,
      unavailable_after: "2026-12-31T23:59:00.000Z",
      noarchive: true,
      nocache: true,
    });
  });

  it("serves the answer's controls where the route gives none", async () => {
    provide({
      resolve: () => ({
        robots: { index: true, follow: true, maxImagePreview: "large" },
      }),
    });
    const metadata = await pageMetadataFor({
      ...page,
      code: undefined,
      tags: [],
    });
    expect(metadata.robots).toEqual({
      index: true,
      follow: true,
      "max-image-preview": "large",
    });
  });

  it("serves the stricter of the route's and the answer's limits", async () => {
    provide({
      resolve: () => ({
        robots: {
          index: true,
          follow: true,
          maxImagePreview: "large",
          maxSnippet: 120,
          unavailableAfter: "2027-01-01T00:00:00.000Z",
        },
      }),
    });
    const metadata = await pageMetadataFor({
      ...page,
      code: {
        robots:
          "max-image-preview:standard, max-snippet:50, noarchive, unavailable_after: 2026-06-01T00:00:00.000Z",
      },
      tags: [],
    });
    expect(metadata.robots).toEqual({
      index: true,
      follow: true,
      "max-image-preview": "standard",
      "max-snippet": 50,
      noarchive: true,
      unavailable_after: "2026-06-01T00:00:00.000Z",
    });
  });

  it("lets a page's own stricter choice win over the route's looser one", async () => {
    provide({
      resolve: () => ({
        robots: {
          index: true,
          follow: true,
          maxImagePreview: "none",
          maxSnippet: 30,
          nosnippet: true,
        },
      }),
    });
    const metadata = await pageMetadataFor({
      ...page,
      code: {
        robots: {
          index: true,
          follow: true,
          "max-image-preview": "large",
          "max-snippet": -1,
        },
      },
      tags: [],
    });
    expect(metadata.robots).toEqual({
      index: true,
      follow: true,
      "max-image-preview": "none",
      "max-snippet": 30,
      nosnippet: true,
    });
  });

  it.each([
    [
      "an image preview size Google has no name for",
      { maxImagePreview: "huge" },
    ],
    ["a snippet length that is not a whole number", { maxSnippet: 2.5 }],
    ["a snippet length below no limit", { maxSnippet: -2 }],
    ["a switch that is not on or off", { nosnippet: "yes" }],
    ["a date that is not text", { unavailableAfter: 20261231 }],
  ])("refuses an answer with %s", async (_, controls) => {
    provide({
      resolve: () =>
        ({
          title: "Answered",
          robots: { index: true, follow: true, ...controls },
        }) as unknown as PageMetadataAnswer,
    });
    const metadata = await pageMetadataFor({
      ...page,
      code: { title: "Own" },
      tags: [],
    });
    expect(metadata.title).toBe("Own");
  });
});

describe("a date to leave results that is not one", () => {
  it.each([
    ["text that names no date", "not-a-date"],
    ["a day the calendar does not have", "2026-02-30T00:00:00Z"],
    ["a time the clock does not have", "2026-12-31T25:00:00Z"],
    ["a date with no time", "2026-12-31"],
    ["a time with no zone", "2026-12-31T23:59:00"],
  ])("leaves out %s, keeps the rest, and says so once", async (_, value) => {
    const warn = vi.spyOn(consoleLogger, "warn").mockImplementation(() => {});
    provide({
      resolve: () => ({
        title: "Answered",
        robots: {
          index: true,
          follow: true,
          maxImagePreview: "large",
          unavailableAfter: value,
        },
      }),
    });
    const first = await pageMetadataFor({ ...page, code: undefined, tags: [] });
    await pageMetadataFor({ ...page, code: undefined, tags: [] });
    expect(first.title).toEqual({ absolute: "Answered" });
    expect(first.robots).toEqual({
      index: true,
      follow: true,
      "max-image-preview": "large",
    });
    const said = warn.mock.calls.filter(([message]) =>
      String(message).includes(value)
    );
    expect(said).toHaveLength(1);
    warn.mockRestore();
  });

  it("serves a date and time with its zone, as Google reads it", async () => {
    provide({
      resolve: () => ({
        robots: {
          index: true,
          follow: true,
          unavailableAfter: "2026-12-31T23:59:00+05:00",
        },
      }),
    });
    const metadata = await pageMetadataFor({
      ...page,
      code: undefined,
      tags: [],
    });
    expect(metadata.robots).toMatchObject({
      unavailable_after: "2026-12-31T23:59:00+05:00",
    });
  });
});

describe("the route's own canonical", () => {
  it("is kept where the answer has none, such as a type with no public address", async () => {
    provide({ resolve: () => ({ title: "Feature" }) });
    const metadata = await pageMetadataFor({
      ...page,
      code: {
        alternates: {
          canonical: "https://example.com/features/a",
          types: { "text/markdown": "/features/a.md" },
        },
        openGraph: { url: "https://example.com/features/a", type: "article" },
      },
      tags: [],
    });
    expect(metadata.alternates).toEqual({
      canonical: "https://example.com/features/a",
      types: { "text/markdown": "/features/a.md" },
    });
    expect(metadata.openGraph).toMatchObject({
      url: "https://example.com/features/a",
      type: "article",
      title: { absolute: "Feature" },
    });
  });
});

describe("a worker where nothing has started Nextly yet", () => {
  const resolver: PageMetadataResolver = {
    resolve: () => ({
      title: "Answered",
      structuredData: [{ "@type": "WebPage", name: "Answered" }],
    }),
  };

  it("starts Nextly before asking, so the page is served the provider's answer", async () => {
    // Every read of this worker was a cache hit, so nothing started Nextly
    // and no boot has recorded the providers.
    forgetCapabilityProviders();
    start.boot = () => provide(resolver);
    const metadata = await pageMetadataFor({
      ...page,
      code: { title: "Own" },
      tags: [],
    });
    expect(metadata.title).toEqual({ absolute: "Answered" });
    expect(start.calls).toBe(1);
  });

  it("starts Nextly before reading the page's structured data", async () => {
    forgetCapabilityProviders();
    start.boot = () => provide(resolver);
    const text = await pageStructuredDataFor({
      ...page,
      code: undefined,
      tags: [],
    });
    expect(JSON.parse(text ?? "")).toMatchObject({
      "@graph": [{ "@type": "WebPage", name: "Answered" }],
    });
  });

  it("starts nothing once a start has recorded the providers", async () => {
    provide(resolver);
    await pageMetadataFor({ ...page, code: undefined, tags: [] });
    recordCapabilityProviders([]);
    await pageMetadataFor({ ...page, code: undefined, tags: [] });
    expect(start.calls).toBe(0);
  });

  it("serves the route's own metadata where Nextly cannot be started", async () => {
    forgetCapabilityProviders();
    start.fails = true;
    const code: Metadata = { title: "Own" };
    expect(await pageMetadataFor({ ...page, code, tags: [] })).toBe(code);
    expect(start.calls).toBe(1);
  });
});

describe("the answer's other forms of the page", () => {
  it("are placed as alternate links by media type, beside the canonical", () => {
    expect(
      metadataFromAnswer({
        canonical: "/blog/hello",
        formats: { "text/markdown": "/blog/hello.md" },
      }).alternates
    ).toEqual({
      canonical: "/blog/hello",
      types: { "text/markdown": "/blog/hello.md" },
    });
  });

  it("are nothing where the answer has none, or an empty set", () => {
    expect(metadataFromAnswer({ formats: {} }).alternates).toBeUndefined();
  });

  it("replace the route's own alternate forms, keeping its language links", async () => {
    provide({
      resolve: () => ({
        canonical: "/blog/hello",
        formats: { "text/markdown": "/blog/hello.md" },
      }),
    });
    const meta = await pageMetadataFor({
      ...page,
      code: {
        alternates: {
          languages: { de: "/de/blog/hello" },
          types: { "text/markdown": "/old.md" },
        },
      },
      tags: [],
    });
    expect(meta.alternates).toEqual({
      canonical: "/blog/hello",
      languages: { de: "/de/blog/hello" },
      types: { "text/markdown": "/blog/hello.md" },
    });
  });

  it("refuse the answer whole where one is keyed by anything but a media type", async () => {
    provide({
      resolve: () => ({
        title: "Answered",
        formats: { "markdown copy": "/blog/hello.md" },
      }),
    });
    const code: Metadata = { title: "Own" };
    expect(await pageMetadataFor({ ...page, code, tags: [] })).toEqual(code);
  });
});

describe("the answer's verification tags", () => {
  it("are placed as meta tags by name", () => {
    expect(
      metadataFromAnswer({
        verification: {
          "msvalidate.01": "8A2F61C4",
          "p:domain_verify": "a91c7e04",
        },
      })
    ).toEqual({
      verification: {
        other: { "msvalidate.01": "8A2F61C4", "p:domain_verify": "a91c7e04" },
      },
    });
  });

  it("are nothing where the answer has none, or an empty set", () => {
    expect(metadataFromAnswer({}).verification).toBeUndefined();
    expect(
      metadataFromAnswer({ verification: {} }).verification
    ).toBeUndefined();
  });

  it("join the route's own, keeping both where they share a name", async () => {
    provide({
      resolve: () => ({
        verification: {
          "msvalidate.01": "ANSWERED",
          "yandex-verification": "y1",
        },
      }),
    });
    const metadata = await pageMetadataFor({
      ...page,
      code: {
        verification: { google: "g1", other: { "msvalidate.01": "OWN" } },
      },
      tags: [],
    });
    expect(metadata.verification).toEqual({
      google: "g1",
      other: {
        "msvalidate.01": ["OWN", "ANSWERED"],
        "yandex-verification": "y1",
      },
    });
  });

  it("keep the route's own where the answer has none", async () => {
    provide({ resolve: () => ({ title: "Answered" }) });
    const metadata = await pageMetadataFor({
      ...page,
      code: { verification: { google: "g1" } },
      tags: [],
    });
    expect(metadata.verification).toEqual({ google: "g1" });
  });

  it("refuse an answer naming a tag by something that is not a meta name", async () => {
    provide({
      resolve: () => ({
        title: "Answered",
        verification: { 'x" onload="alert(1)': "a" },
      }),
    });
    const metadata = await pageMetadataFor({
      ...page,
      code: { title: "Own" },
      tags: [],
    });
    expect(metadata.verification).toBeUndefined();
    expect(cacheOutcomes).toEqual([{ refused: true }]);
  });
});
