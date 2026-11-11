/**
 * One answer per page, for each kind of page a route resolves: every value
 * the head is built from comes from the one order, with its source.
 *
 * Core's address answers are stood in for: each type's declared address and
 * the language rule (every language but the default under its code).
 */
import type {
  PageMetadataInput,
  PluginContext,
  PublicAddressType,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

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

/** A plugin context with the one service the resolver uses: media by id. */
function context(media: Record<string, Record<string, unknown>> = {}) {
  return {
    services: {
      media: {
        findById: async (id: string) => {
          const found = media[id];
          if (found === undefined) throw new Error("not found");
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
