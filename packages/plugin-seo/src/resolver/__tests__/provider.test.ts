/**
 * One answer per page, for each kind of page a route resolves: every value
 * the head is built from comes from the one order, with its source.
 *
 * Core's address answers are stood in for: each type's declared address and
 * the language rule (every language but the default under its code).
 */
import { createHash } from "node:crypto";

import {
  NextlyError,
  type PageMetadataInput,
  type PluginContext,
  type PublicAddressType,
} from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fillPattern, type SiteRules } from "../page-levels";
import { answerOf, resolveSeo, seoPageMetadata } from "../provider";

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  publicAddressOf: async (
    type: PublicAddressType,
    entry?: Readonly<Record<string, unknown>>
  ) => {
    if (type.kind === "single") {
      return type.slug === "home"
        ? { status: "resolved", path: "/" }
        : { status: "none" };
    }
    if (type.slug === "notes") return { status: "none" };
    const slug = entry?.slug;
    return typeof slug === "string"
      ? {
          status: "resolved",
          path: type.slug === "posts" ? `/blog/${slug}` : `/${slug}`,
        }
      : { status: "unavailable" };
  },
  languageAddressOf: async (path: string, locale: string) => ({
    status: "resolved",
    path: locale === "en" ? path : `/${locale}${path === "/" ? "" : path}`,
  }),
}));

/**
 * A plugin context with the one service the resolver uses: media by id,
 * answering a missing id as the media service does, and `failing` ids with
 * a fault that is not about the image at all.
 */
/** The record's unique key of the address `path` in `locale`. */
function addressKey(locale: string, path: string): string {
  return createHash("sha256")
    .update(`address:${locale}|${path}`, "utf8")
    .digest("hex");
}

function context(
  media: Record<string, Record<string, unknown>> = {},
  failing: readonly string[] = [],
  holders: Record<string, { collection: string; id: string }> = {}
) {
  return {
    self: { collections: {} },
    config: {},
    services: {
      // The address record: who holds each path in English, read by the
      // rows' unique keys as the record stores them.
      ownCollections: {
        listEntries: async (
          _slug: string,
          options: { where?: { claimKey?: { in?: string[] } } }
        ) => {
          const keys = options.where?.claimKey?.in ?? [];
          const path = Object.keys(holders).find(held =>
            keys.includes(addressKey("en", held))
          );
          const held = path === undefined ? undefined : holders[path];
          return {
            data:
              held === undefined
                ? []
                : [
                    {
                      id: "r1",
                      kind: "address",
                      locale: "en",
                      path,
                      holderCollection: held.collection,
                      holderId: held.id,
                    },
                  ],
          };
        },
      },
      media: {
        findById: async (id: string) => {
          if (failing.includes(id)) throw new Error("connection reset");
          const found = media[id];
          if (found === undefined) {
            throw NextlyError.notFound({ logContext: { id } });
          }
          return found;
        },
      },
    },
  } as unknown as PluginContext;
}

function entryInput(
  collection: string,
  entry: Record<string, unknown>,
  extra: Partial<PageMetadataInput> = {}
): PageMetadataInput {
  return {
    source: { kind: "entry", collection, entry },
    code: {},
    derived: {},
    ...extra,
  };
}

const RULES: SiteRules = {
  siteName: "Acme",
  description: "Acme makes things.",
  image: { url: "/site.jpg" },
  patterns: { posts: { title: "{Title} | {Site name}" } },
};

describe("one answer for each kind of page", () => {
  it("a collection entry: what was typed, else its pattern, its content and the site", async () => {
    const answer = await resolveSeo(
      context(),
      entryInput("posts", {
        slug: "hello",
        title: "Hello",
        excerpt: "A first post.",
        seo: { metaDescription: "Typed description" },
      }),
      async () => RULES
    );
    expect(answer.title).toEqual({
      value: "Hello | Acme",
      from: "pattern",
      pattern: "{Title} | {Site name}",
    });
    expect(answer.description).toEqual({
      value: "Typed description",
      from: "page",
    });
    expect(answer.canonical).toEqual({ value: "/blog/hello", from: "address" });
    expect(answer.image).toEqual({ value: { url: "/site.jpg" }, from: "site" });
    expect(answer.robots.value).toEqual({ index: true, follow: true });
  });

  it("a Single: its own address, its content, the site's defaults", async () => {
    const answer = await resolveSeo(
      context(),
      {
        source: {
          kind: "single",
          slug: "home",
          document: { headline: "Welcome", title: "Home" },
        },
        code: {},
        derived: {},
      },
      async () => RULES
    );
    expect(answer.title).toEqual({
      value: "Home",
      from: "content",
      field: "title",
    });
    expect(answer.description).toEqual({
      value: "Acme makes things.",
      from: "site",
    });
    expect(answer.canonical).toEqual({ value: "/", from: "address" });
  });

  it("a Page Builder page: its design's rule under what a person typed", async () => {
    const answer = await resolveSeo(
      context(),
      entryInput(
        "pages",
        { slug: "about", title: "About", seo: { metaTitle: "About us" } },
        {
          derived: {
            title: "From the design",
            description: "The design's description",
          },
        }
      )
    );
    expect(answer.title).toEqual({ value: "About us", from: "page" });
    expect(answer.description).toEqual({
      value: "The design's description",
      from: "template",
    });
  });

  it("a code-rendered page: code fills what nobody typed, field by field", async () => {
    const answer = await resolveSeo(
      context(),
      entryInput(
        "pages",
        { slug: "pricing", seo: { metaTitle: "Pricing plans" } },
        { code: { title: "Pricing | Code", description: "From the route" } }
      )
    );
    expect(answer.title).toEqual({ value: "Pricing plans", from: "page" });
    expect(answer.description).toEqual({
      value: "From the route",
      from: "code",
    });
  });

  it("a document served at an address another document holds names its own address", async () => {
    // The route served this post at /old, which another page holds; its
    // canonical is still the address it declares for itself.
    const answer = await resolveSeo(
      context(),
      entryInput("posts", { slug: "moved", title: "Moved" }, { path: "/old" })
    );
    expect(answer.canonical).toEqual({ value: "/blog/moved", from: "address" });
  });

  it("a later page of the document's list keeps its own address", async () => {
    const at = async (path: string, locale?: string) =>
      (
        await resolveSeo(
          context(),
          entryInput(
            "pages",
            { slug: "news" },
            { path, ...(locale === undefined ? {} : { locale }) }
          )
        )
      ).canonical;
    expect(await at("/news/page/2")).toEqual({
      value: "/news/page/2",
      from: "address",
    });
    expect(await at("/de/news/page/3", "de")).toEqual({
      value: "/de/news/page/3",
      from: "address",
    });
    // Page 1 under a second spelling, a number spelled otherwise, or a list
    // that is not this document's: the document's own address.
    for (const path of ["/news/page/1", "/news/page/02", "/other/page/2"]) {
      expect(await at(path)).toEqual({ value: "/news", from: "address" });
    }
  });

  it("a page in another language: its address in that language", async () => {
    const answer = await resolveSeo(
      context(),
      entryInput("pages", { slug: "ueber" }, { locale: "de" })
    );
    expect(answer.canonical).toEqual({ value: "/de/ueber", from: "address" });
  });

  it("a type with no declared address has no canonical, never a guess", async () => {
    const answer = await resolveSeo(
      context(),
      entryInput("notes", { slug: "x", title: "A note" })
    );
    expect(answer.canonical).toBeUndefined();
  });

  it("a hidden page: not listed, whatever its route's code says", async () => {
    const provider = seoPageMetadata(context());
    const answer = await provider.resolve(
      entryInput(
        "pages",
        { slug: "draft-ideas", seo: { noindex: true } },
        { code: { title: "Ideas" } }
      )
    );
    expect(answer.robots).toEqual({ index: false, follow: true });
    expect(answer.title).toBe("Ideas");
  });

  it("a share image stored by id is looked up, and one that cannot be is skipped", async () => {
    const ctx = context({
      m1: {
        url: "/media/cover.jpg",
        width: 1200,
        height: 630,
        altText: "Cover",
      },
    });
    const found = await resolveSeo(
      ctx,
      entryInput("pages", { slug: "a", seo: { ogImage: "m1" } })
    );
    expect(found.image).toEqual({
      value: {
        url: "/media/cover.jpg",
        width: 1200,
        height: 630,
        alt: "Cover",
      },
      from: "page",
    });
    const missing = await resolveSeo(
      ctx,
      entryInput("pages", {
        slug: "a",
        seo: { ogImage: "gone" },
        coverImage: "m1",
      })
    );
    expect(missing.image).toMatchObject({
      from: "content",
      field: "coverImage",
    });
  });
});

describe("what the answer depends on", () => {
  it("a lookup that fails for any reason but a missing image is not answered as no image", async () => {
    // Answered, the head would be cached without the image until the page
    // next changed; thrown, core serves the route's own head uncached.
    await expect(
      resolveSeo(
        context({}, ["m1"]),
        entryInput("pages", { slug: "a", seo: { ogImage: "m1" } })
      )
    ).rejects.toThrow("connection reset");
  });

  it("looks up no lower image once a higher level has one", async () => {
    // The cover image's lookup would fail; the typed image wins first, so it
    // is never asked for and the answer stands.
    const answer = await resolveSeo(
      context({ m1: { url: "/typed.jpg" } }, ["broken"]),
      entryInput("pages", {
        slug: "a",
        seo: { ogImage: "m1", metaTitle: "Typed" },
        coverImage: "broken",
      })
    );
    expect(answer.image).toEqual({
      value: { url: "/typed.jpg" },
      from: "page",
    });
    expect(answer.title).toEqual({ value: "Typed", from: "page" });
    const fromCode = await resolveSeo(
      context({}, ["broken"]),
      entryInput(
        "pages",
        { slug: "a", coverImage: "broken" },
        { code: { image: { url: "/code.jpg" } } }
      )
    );
    expect(fromCode.image).toEqual({
      value: { url: "/code.jpg" },
      from: "code",
    });
  });

  it("goes on to the next content image where one names an image that is gone", async () => {
    const answer = await resolveSeo(
      context({ f1: { url: "/featured.jpg" } }),
      entryInput("pages", {
        slug: "a",
        coverImage: "deleted",
        featuredImage: "f1",
      })
    );
    expect(answer.image).toEqual({
      value: { url: "/featured.jpg" },
      from: "content",
      field: "featuredImage",
    });
  });

  it("names the media tags, so a changed or deleted image expires the head", () => {
    const tags = seoPageMetadata(context()).tags?.(
      entryInput("pages", { slug: "a", seo: { ogImage: "m1" } })
    );
    expect(tags).toEqual(expect.arrayContaining(["nextly:media"]));
  });
});

describe("a typed canonical", () => {
  it.each(["mailto:hi@example.com", "javascript:alert(1)", "   "])(
    "%s is not one: the page's own address is used",
    async canonical => {
      const answer = await resolveSeo(
        context(),
        entryInput("pages", { slug: "about", seo: { canonical } })
      );
      expect(answer.canonical).toEqual({ value: "/about", from: "address" });
    }
  );

  it("is trimmed, and used where it is a web address or a path", async () => {
    for (const [typed, used] of [
      ["  https://example.com/original  ", "https://example.com/original"],
      ["/elsewhere", "/elsewhere"],
    ]) {
      const answer = await resolveSeo(
        context(),
        entryInput("pages", {
          slug: "about",
          // Confirmed: the page first appeared at that address.
          seo: { canonical: typed, canonicalElsewhere: true },
        })
      );
      expect(answer.canonical).toEqual({ value: used, from: "page" });
    }
  });
});

describe("the answer core builds the head from", () => {
  it("is the values without their sources, the site's name on the card", () => {
    expect(
      answerOf(
        {
          title: { value: "T", from: "page" },
          description: { value: "D", from: "code" },
          socialTitle: { value: "T", from: "page" },
          canonical: { value: "/t", from: "address" },
          robots: { value: { index: true, follow: true }, from: "site" },
        },
        { siteName: "Acme" }
      )
    ).toEqual({
      title: "T",
      description: "D",
      canonical: "/t",
      robots: { index: true, follow: true },
      social: { title: "T", siteName: "Acme" },
    });
  });
});

describe("a pattern", () => {
  it("fills its tokens from the page, in any case or spacing", () => {
    expect(
      fillPattern(
        "{Title} in {category} | {Site name}",
        { title: "Hello", siteName: "Acme" },
        { category: "News" }
      )
    ).toBe("Hello in News | Acme");
  });

  it("gives nothing where a token has no value, so the next level answers", () => {
    expect(
      fillPattern("{Title} | {Site name}", { title: "Hello" }, {})
    ).toBeUndefined();
  });
});

describe("the canonical a page is given, with addresses from the environment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("takes a typed address on a production address the environment names", async () => {
    vi.stubEnv("NEXTLY_PRODUCTION_ADDRESSES", "https://acme.example");
    const answer = await resolveSeo(
      context(),
      entryInput("pages", {
        id: "p1",
        slug: "about",
        seo: { canonical: "https://acme.example/about-us" },
      })
    );
    expect(answer.canonical).toEqual({
      value: "https://acme.example/about-us",
      from: "page",
    });
  });

  it("names the address record's tags, so a page gaining or losing its address expires the head", () => {
    const tags = seoPageMetadata(context()).tags?.(
      entryInput("pages", { slug: "a" })
    );
    expect(tags).toEqual(expect.arrayContaining(["nextly:nx_seo_addresses"]));
  });
});

describe("the canonical a page is given", () => {
  it("is none where another page holds its address, having lost it in a clash", async () => {
    const answer = await resolveSeo(
      context({}, [], { "/news": { collection: "posts", id: "p9" } }),
      entryInput("pages", { id: "p1", slug: "news", title: "News" })
    );
    expect(answer.canonical).toBeUndefined();
  });

  it("is its own address where it holds it, or where no page does yet", async () => {
    const held = await resolveSeo(
      context({}, [], { "/news": { collection: "pages", id: "p1" } }),
      entryInput("pages", { id: "p1", slug: "news" })
    );
    expect(held.canonical).toEqual({ value: "/news", from: "address" });
    const unrecorded = await resolveSeo(
      context(),
      entryInput("pages", { id: "p1", slug: "news" })
    );
    expect(unrecorded.canonical).toEqual({ value: "/news", from: "address" });
  });

  it("takes a typed address off the site only where the page first appeared there", async () => {
    const typed = (seo: Record<string, unknown>, rules?: SiteRules) =>
      resolveSeo(
        context(),
        entryInput("pages", { id: "p1", slug: "about", seo }),
        async () => rules ?? { patterns: {} }
      );
    // Off the site, not confirmed: the page's own address.
    expect(
      (await typed({ canonical: "https://elsewhere.example/a" })).canonical
    ).toEqual({ value: "/about", from: "address" });
    // Confirmed: the typed address.
    expect(
      (
        await typed({
          canonical: "https://elsewhere.example/a",
          canonicalElsewhere: true,
        })
      ).canonical
    ).toEqual({ value: "https://elsewhere.example/a", from: "page" });
    // On one of the site's production addresses: taken.
    expect(
      (
        await typed(
          { canonical: "https://acme.example/about-us" },
          { productionAddresses: ["https://acme.example"], patterns: {} }
        )
      ).canonical
    ).toEqual({ value: "https://acme.example/about-us", from: "page" });
  });
});
