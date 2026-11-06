/**
 * The share preview: the SEO fields, then what the page offers, then its
 * title, with only what every visitor sees speaking for the page.
 */
import type {
  BlockDocument,
  SeoDefinitionSource,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { sharePreview } from "./share-preview";

/** A block that offers its props as the page's title, prose and image. */
const definitions: SeoDefinitionSource = type =>
  type === "test/hero"
    ? {
        seo: ((props: { heading?: string; body?: string; image?: string }) => ({
          ...(props.heading === undefined ? {} : { title: props.heading }),
          ...(props.body === undefined ? {} : { description: props.body }),
          ...(props.image === undefined ? {} : { image: props.image }),
        })) as never,
      }
    : undefined;

function page(...nodes: BlockDocument["nodes"]): BlockDocument {
  return { formatVersion: 1, kind: "page", nodes } as BlockDocument;
}

const hero = {
  id: "h",
  type: "test/hero",
  version: 1,
  props: {
    heading: "Who we are",
    body: "We build tools people keep.",
    image: "/uploads/team.jpg",
  },
};

describe("the share preview", () => {
  it("takes what the page offers when there are no SEO fields", () => {
    expect(
      sharePreview({
        seo: undefined,
        document: page(hero),
        pageTitle: "About us",
        definitions,
      })
    ).toEqual({
      title: "Who we are",
      description: "We build tools people keep.",
      image: { kind: "url", url: "/uploads/team.jpg" },
    });
  });

  it("never fetches an image from another site's address", () => {
    // The published page keeps such an image only when the site allows its
    // host, a list only the server holds, so the preview shows a stand-in.
    const elsewhere = {
      ...hero,
      props: { ...hero.props, image: "https://cdn.example.com/team.jpg" },
    };
    const image = (document: BlockDocument, ogImage?: unknown) =>
      sharePreview({
        seo: ogImage === undefined ? undefined : { ogImage },
        document,
        pageTitle: "About us",
        definitions,
      }).image;
    expect(image(page(elsewhere))).toEqual({ kind: "remote" });
    expect(image(page(), "//cdn.example.com/og.png")).toEqual({
      kind: "remote",
    });
  });

  it("lets the SEO fields speak first", () => {
    expect(
      sharePreview({
        seo: {
          metaTitle: "About · Acme",
          metaDescription: "  ",
          ogImage: { url: "https://cdn.example.com/og.png" },
        },
        document: page(hero),
        pageTitle: "About us",
        definitions,
      })
    ).toEqual({
      title: "About · Acme",
      // A blank field says nothing, so the page's own prose stands in.
      description: "We build tools people keep.",
      image: { kind: "url", url: "https://cdn.example.com/og.png" },
    });
  });

  it("falls back to the page's title, and leaves out what it has not got", () => {
    expect(
      sharePreview({
        seo: undefined,
        document: page(),
        pageTitle: "About us",
        definitions,
      })
    ).toEqual({ title: "About us" });
  });

  it("does not let content behind a condition speak for the page", () => {
    const gated = {
      ...hero,
      visibility: { conditions: [{ kind: "signedIn" }] },
    };
    expect(
      sharePreview({
        seo: undefined,
        document: page(gated),
        pageTitle: "About us",
        definitions,
      })
    ).toEqual({ title: "About us" });
  });

  it("shows a library image as a stand-in, by kind", () => {
    expect(
      sharePreview({
        seo: { ogImage: { id: "media-1" } },
        document: page(),
        pageTitle: "About us",
        definitions,
      }).image
    ).toEqual({ kind: "media" });
  });

  it("reads an upload's stored id as a library image, and an address as an address", () => {
    const of = (ogImage: unknown) =>
      sharePreview({
        seo: { ogImage },
        document: page(),
        pageTitle: "About us",
        definitions,
      }).image;
    expect(of("6f1c2a9e-media-id")).toEqual({ kind: "media" });
    expect(of("https://cdn.example.com/og.png")).toEqual({ kind: "remote" });
    expect(of("/uploads/og.png")).toEqual({
      kind: "url",
      url: "/uploads/og.png",
    });
  });

  it("falls back to the title when nothing on the page is readable", () => {
    expect(
      sharePreview({
        seo: undefined,
        document: null,
        pageTitle: "About us",
        definitions,
      })
    ).toEqual({ title: "About us" });
  });
});
