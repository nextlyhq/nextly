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

  it("finds nothing in a page with no images or links", () => {
    expect(contentFacts({ id: "1", title: "Plain", count: 3 })).toEqual({
      images: [],
      links: [],
    });
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
        isHeld: async path => {
          asked.push(path);
          return false;
        },
      }
    );
    expect(asked).toEqual(["/blog/gone"]);
  });
});
