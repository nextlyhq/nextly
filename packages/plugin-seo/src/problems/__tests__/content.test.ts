/**
 * What a page's content shows that the list checks: its images and the
 * alt text each is shown with, and its links to addresses on the site,
 * judged against the addresses content types serve.
 */
import { describe, expect, it } from "vitest";

import { contentFacts } from "../content";
import { addressShapes, brokenLinks } from "../links";

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
        isHeld: async path => held.has(path),
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
        isHeld: async path => {
          asked.push(path);
          return false;
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
        isHeld: async path => path === "/blog/caf%C3%A9",
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
        isHeld: async (path, locale) => held.has(`${locale} ${path}`),
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
      isHeld: async (path: string, locale: string) =>
        held.has(`${locale} ${path}`),
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
