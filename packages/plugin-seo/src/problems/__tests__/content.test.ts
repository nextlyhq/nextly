/**
 * What a page's content shows that the list checks: its images and the
 * alt text each is shown with, and its links to addresses on the site,
 * judged against the addresses content types serve.
 */
import { describe, expect, it } from "vitest";

import { contentFacts } from "../content";
import { linkedPageKey } from "../link-graph";
import { addressShapes, brokenLinks, readLinks } from "../links";

const MEDIA = {
  id: "m1",
  filename: "cover.jpg",
  url: "/uploads/cover.jpg",
  mimeType: "image/jpeg",
  altText: null,
  createdAt: "2026-11-01",
};

const BODY = {
  root: {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          { type: "link", url: "/blog/gone?x=1#top", children: [] },
          { type: "autolink", url: "https://example.com/blog/here/" },
          { type: "link", url: "https://elsewhere.com/blog/gone" },
          { type: "link", url: "mailto:a@example.com" },
        ],
      },
      { type: "image", src: "/uploads/chart.png", altText: "" },
      { type: "image", src: "/uploads/map.png", altText: "A map" },
      {
        type: "gallery",
        images: [{ src: "/uploads/g1.png", alt: "" }],
      },
      {
        type: "button-group",
        buttons: [{ url: "/docs/start", text: "Start" }],
      },
    ],
  },
};

describe("contentFacts", () => {
  it("finds each image with its alt text, and each link, by the field holding it", () => {
    const facts = contentFacts({
      id: "7",
      title: "Harbour",
      body: BODY,
      cover: MEDIA,
      // A related page read with the entry: its content is not this page's.
      author: {
        id: "a1",
        createdAt: "2026-11-01",
        bio: {
          root: { type: "root", children: [{ type: "link", url: "/x" }] },
        },
      },
      // The share image is the card's, not an image the page shows.
      seo: { ogImage: MEDIA },
    });
    expect(facts.images).toEqual([
      { field: "body", name: "chart.png", media: false, alt: "" },
      { field: "body", name: "map.png", media: false, alt: "A map" },
      { field: "body", name: "g1.png", media: false, alt: "" },
      { field: "cover", name: "cover.jpg", media: true, alt: null },
    ]);
    expect(facts.links).toEqual([
      { field: "body", url: "/blog/gone?x=1#top" },
      { field: "body", url: "https://example.com/blog/here/" },
      { field: "body", url: "https://elsewhere.com/blog/gone" },
      { field: "body", url: "mailto:a@example.com" },
      { field: "body", url: "/docs/start" },
    ]);
  });

  it("reads Page Builder's image and button blocks, and its decorative mark", () => {
    const facts = contentFacts({
      id: "7",
      layout: {
        root: {
          type: "core/container",
          children: [
            { type: "core/image", props: { src: "/uploads/hero.png" } },
            {
              type: "core/image",
              props: { src: "/uploads/rule.png", alt: "" },
            },
            {
              type: "core/image",
              props: { src: "/uploads/dots.png", decorative: true },
            },
            {
              type: "core/image",
              props: { src: "/uploads/map.png", alt: "Map" },
            },
            // Its alt text falls back to the media library item's own.
            { type: "core/image", props: { mediaId: "m9" } },
            { type: "core/button", props: { label: "Go", href: "/blog/gone" } },
          ],
        },
      },
    });
    expect(facts.images).toEqual([
      { field: "layout", name: "hero.png", media: false, alt: undefined },
      {
        field: "layout",
        name: "rule.png",
        media: false,
        alt: "",
        decorative: true,
      },
      {
        field: "layout",
        name: "dots.png",
        media: false,
        alt: undefined,
        decorative: true,
      },
      { field: "layout", name: "map.png", media: false, alt: "Map" },
    ]);
    expect(facts.links).toEqual([{ field: "layout", url: "/blog/gone" }]);
  });

  it("finds nothing in a page with no images or links", () => {
    expect(contentFacts({ id: "1", title: "Plain", count: 3 })).toEqual({
      images: [],
      links: [],
    });
  });
});

/** A site with one language: every address is kept as it is asked for. */
const inDefaultLanguage = async (url: URL) => ({
  locale: "en",
  path: url.pathname,
});

/** A page holding an address, as the record names it. */
const POST = { collection: "posts", id: "p1" };

describe("readLinks", () => {
  it("names each page the links reach, once, in the language each address is served in, and none outside the site", async () => {
    const keptOf = async (url: URL) =>
      url.pathname.startsWith("/de/")
        ? { locale: "de", path: url.pathname.slice(3) }
        : { locale: "en", path: url.pathname };
    const holders = new Map([
      ["en /blog/here", [{ collection: "posts", id: "p1" }]],
      ["de /blog/here", [{ collection: "posts", id: "p1" }]],
      // A page built in code holds no address in the record.
      ["en /pricing", []],
      ["en /", [{ collection: "single:home", id: "h1" }]],
    ]);
    const read = await readLinks(
      [
        { field: "body", url: "/blog/here" },
        { field: "intro", url: "https://example.com/blog/here#top" },
        { field: "body", url: "/de/blog/here" },
        { field: "body", url: "/pricing" },
        { field: "body", url: "/" },
        { field: "body", url: "https://elsewhere.com/blog/here" },
      ],
      {
        shapes: addressShapes([
          { slug: "posts", publicAddress: "/blog/{slug}" },
        ]),
        productionAddresses: ["https://example.com"],
        keptOf,
        holders: async (path, locale) => holders.get(`${locale} ${path}`) ?? [],
      }
    );
    expect(read.to).toEqual([
      linkedPageKey("posts", "p1", "en"),
      linkedPageKey("posts", "p1", "de"),
      linkedPageKey("single:home", "h1", "en"),
    ]);
    expect(read.broken).toEqual([]);
  });

  it("counts a link a redirect sends into another language for the page in that language", async () => {
    const read = await readLinks([{ field: "body", url: "/blog/old" }], {
      shapes: addressShapes([{ slug: "posts", publicAddress: "/blog/{slug}" }]),
      productionAddresses: [],
      keptOf: async url => ({ locale: "en", path: url.pathname }),
      holders: async () => [{ collection: "nx_seo_redirects", id: "r1" }],
      pagesOf: async () => [{ collection: "posts", id: "p1", locale: "de" }],
    });
    expect(read.to).toEqual([linkedPageKey("posts", "p1", "de")]);
  });

  it("counts a link to an address a redirect holds for the page the redirect sends people to", async () => {
    const redirect = { collection: "nx_seo_redirects", id: "r1" };
    const read = await readLinks([{ field: "body", url: "/blog/old" }], {
      shapes: addressShapes([{ slug: "posts", publicAddress: "/blog/{slug}" }]),
      productionAddresses: [],
      keptOf: async url => ({ locale: "en", path: url.pathname }),
      holders: async path => (path === "/blog/old" ? [redirect] : []),
      pagesOf: async holders =>
        holders.flatMap(each =>
          each.id === "r1" ? [{ collection: "posts", id: "p1" }] : [each]
        ),
    });
    expect(read.to).toEqual([linkedPageKey("posts", "p1", "en")]);
    // Held by the redirect, so not broken.
    expect(read.broken).toEqual([]);
  });
});

describe("brokenLinks", () => {
  const shapes = addressShapes([
    { slug: "posts", publicAddress: "/blog/{slug}" },
    { slug: "docs", publicAddress: "/docs/{slug}", db: { slugPaths: true } },
    // Served from the root, where code-built pages share every address.
    { slug: "pages", publicAddress: "/{slug}" },
    { slug: "notes" },
  ]);
  const held = new Set(["/blog/here", "/docs/a/b"]);

  it("reports a link to an address a content type serves that no page holds", async () => {
    const found = await brokenLinks(
      [
        { field: "body", url: "/blog/gone?x=1#top" },
        { field: "body", url: "https://example.com/blog/here/" },
        { field: "body", url: "https://elsewhere.com/blog/gone" },
        { field: "body", url: "mailto:a@example.com" },
        { field: "body", url: "/docs/a/b" },
        { field: "body", url: "/docs/a/missing" },
        { field: "body", url: "/pricing" },
        { field: "body", url: "//cdn.example.com/blog/x" },
      ],
      {
        shapes,
        productionAddresses: ["https://example.com"],
        keptOf: inDefaultLanguage,
        holders: async path => (held.has(path) ? [POST] : []),
      }
    );
    expect(found).toEqual([
      { field: "body", url: "/blog/gone?x=1#top" },
      { field: "body", url: "/docs/a/missing" },
    ]);
  });

  it("asks about each address once, however many links name it", async () => {
    const asked: string[] = [];
    await brokenLinks(
      [
        { field: "body", url: "/blog/gone" },
        { field: "intro", url: "/blog/gone/" },
      ],
      {
        shapes,
        productionAddresses: [],
        keptOf: inDefaultLanguage,
        holders: async path => {
          asked.push(path);
          return [];
        },
      }
    );
    expect(asked).toEqual(["/blog/gone"]);
  });

  it("reads a link's address as the record keeps it, encoded and without dot segments", async () => {
    const found = await brokenLinks(
      [
        { field: "body", url: "/blog/café" },
        { field: "body", url: "/blog/./café" },
        { field: "body", url: "https://example.com/blog/café" },
      ],
      {
        shapes,
        productionAddresses: ["https://example.com"],
        keptOf: inDefaultLanguage,
        holders: async path => (path === "/blog/caf%C3%A9" ? [POST] : []),
      }
    );
    expect(found).toEqual([]);
  });

  it("asks who holds a link's address in the language it is served in", async () => {
    // French is served on its own domain, and German under a prefix.
    const keptOf = async (url: URL) =>
      url.host === "fr.example.com"
        ? { locale: "fr", path: url.pathname }
        : url.pathname.startsWith("/de/")
          ? { locale: "de", path: url.pathname.slice(3) }
          : { locale: "en", path: url.pathname };
    const held = new Set(["fr /blog/bonjour", "en /blog/hello"]);
    const found = await brokenLinks(
      [
        { field: "body", url: "https://fr.example.com/blog/bonjour" },
        { field: "body", url: "https://fr.example.com/blog/hello" },
        { field: "body", url: "/de/blog/hello" },
        { field: "body", url: "/blog/hello" },
      ],
      {
        shapes,
        productionAddresses: ["https://example.com", "https://fr.example.com"],
        keptOf,
        holders: async (path, locale) =>
          held.has(`${locale} ${path}`) ? [POST] : [],
      }
    );
    expect(found).toEqual([
      { field: "body", url: "https://fr.example.com/blog/hello" },
      { field: "body", url: "/de/blog/hello" },
    ]);
  });

  it("reads a path from the root on the origin the linking page is served on", async () => {
    const keptOf = async (url: URL) => ({
      locale: url.host === "fr.example.com" ? "fr" : "en",
      path: url.pathname,
    });
    const held = new Set(["fr /blog/bonjour"]);
    const judge = {
      shapes,
      productionAddresses: ["https://en.example.com", "https://fr.example.com"],
      keptOf,
      holders: async (path: string, locale: string) =>
        held.has(`${locale} ${path}`) ? [POST] : [],
    };
    const link = [{ field: "body", url: "/blog/bonjour" }];
    expect(
      await brokenLinks(link, { ...judge, origin: "https://fr.example.com" })
    ).toEqual([]);
    expect(
      await brokenLinks(link, { ...judge, origin: "https://en.example.com" })
    ).toEqual(link);
  });
});
