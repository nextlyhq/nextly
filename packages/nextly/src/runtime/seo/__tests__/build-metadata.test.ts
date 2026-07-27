import { describe, expect, it } from "vitest";

import { buildMetadata } from "../build-metadata";

describe("buildMetadata", () => {
  it("maps a fully-populated seo group to Metadata", () => {
    const meta = buildMetadata({
      seo: {
        metaTitle: "Meta Title",
        metaDescription: "Meta description.",
        ogImage: { url: "https://cdn.example/og.png" },
        canonical: "https://example.com/post",
        noindex: false,
      },
    });

    expect(meta.title).toBe("Meta Title");
    expect(meta.description).toBe("Meta description.");
    expect(meta.alternates).toEqual({ canonical: "https://example.com/post" });
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.openGraph).toMatchObject({
      title: "Meta Title",
      description: "Meta description.",
      url: "https://example.com/post",
      images: [{ url: "https://cdn.example/og.png" }],
    });
    expect(meta.twitter).toMatchObject({
      card: "summary_large_image",
      title: "Meta Title",
      description: "Meta description.",
      images: ["https://cdn.example/og.png"],
    });
  });

  it("falls back to the provided values when seo fields are blank", () => {
    const meta = buildMetadata(
      { seo: { metaTitle: "", metaDescription: "   " } },
      {
        fallback: {
          title: "Post Title",
          description: "The excerpt.",
          image: "https://cdn.example/featured.png",
          canonical: "/blog/hello",
        },
      }
    );

    expect(meta.title).toBe("Post Title");
    expect(meta.description).toBe("The excerpt.");
    expect(meta.alternates).toEqual({ canonical: "/blog/hello" });
    expect(meta.openGraph).toMatchObject({
      images: [{ url: "https://cdn.example/featured.png" }],
    });
  });

  it("prefers the seo field over the fallback", () => {
    const meta = buildMetadata(
      { seo: { metaTitle: "SEO Title" } },
      { fallback: { title: "Entry Title" } }
    );
    expect(meta.title).toBe("SEO Title");
  });

  it("sets robots to noindex/nofollow when noindex is true", () => {
    const meta = buildMetadata({ seo: { noindex: true } });
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("returns minimal, indexable metadata when there is no seo group", () => {
    const meta = buildMetadata({});
    expect(meta.title).toBeUndefined();
    expect(meta.description).toBeUndefined();
    expect(meta.alternates).toBeUndefined();
    expect(meta.openGraph).toBeUndefined();
    expect(meta.twitter).toBeUndefined();
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it("ignores an unresolved ogImage id and uses the image fallback", () => {
    const meta = buildMetadata(
      { seo: { ogImage: "media-id-123" } },
      { fallback: { image: "https://cdn.example/fallback.png" } }
    );
    expect(meta.openGraph).toMatchObject({
      images: [{ url: "https://cdn.example/fallback.png" }],
    });
    expect(meta.twitter).toMatchObject({
      images: ["https://cdn.example/fallback.png"],
    });
  });

  it("omits image-derived fields when there is no image", () => {
    const meta = buildMetadata({ seo: { metaTitle: "T" } });
    expect(meta.openGraph).not.toHaveProperty("images");
    // No image → no large-image twitter card is implied by an image.
    expect(meta.twitter).not.toHaveProperty("images");
  });

  it("maps locale alternates to alternates.languages", () => {
    const meta = buildMetadata(
      { seo: { canonical: "https://example.com/en/p" } },
      {
        languages: {
          en: "https://example.com/en/p",
          de: "https://example.com/de/p",
        },
      }
    );
    expect(meta.alternates).toEqual({
      canonical: "https://example.com/en/p",
      languages: {
        en: "https://example.com/en/p",
        de: "https://example.com/de/p",
      },
    });
  });

  it("merges caller openGraph and twitter extras on top of the derived fields", () => {
    const meta = buildMetadata(
      { seo: { metaTitle: "T", metaDescription: "D" } },
      {
        openGraph: {
          type: "article",
          publishedTime: "2026-01-02T00:00:00.000Z",
        },
        twitter: { creator: "@author" },
      }
    );
    expect(meta.openGraph).toMatchObject({
      title: "T",
      description: "D",
      type: "article",
      publishedTime: "2026-01-02T00:00:00.000Z",
    });
    expect(meta.twitter).toMatchObject({ title: "T", creator: "@author" });
  });

  it("does not set alternates when neither canonical nor languages are present", () => {
    const meta = buildMetadata({ seo: { metaTitle: "T" } });
    expect(meta.alternates).toBeUndefined();
  });
});
