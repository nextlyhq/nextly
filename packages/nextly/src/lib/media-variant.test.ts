// Why: media URL absolutization is a contract with every API consumer
// (mobile apps, SSR, edge workers). The local storage adapter writes
// relative URLs; cloud adapters write absolute URLs. These tests lock the
// rules so a future refactor can't silently double-prefix cloud URLs or
// leak unreachable relative paths to clients. Base-URL resolution itself
// is covered separately by shared/lib/__tests__/get-base-url.test.ts.
//
// The `getBaseUrl` mock below is configured to throw — pass-through code
// paths (absolute URLs, null/undefined inputs) must never reach it, and
// any test that needs a base URL passes one explicitly.
import { describe, expect, it, vi } from "vitest";

vi.mock("./get-base-url", () => ({
  getBaseUrl: () => {
    throw new Error(
      "getBaseUrl() should not be called when an explicit baseUrl is provided or the URL is a pass-through"
    );
  },
}));

import { absolutizeMediaUrls, toAbsoluteMediaUrl } from "./media-variant";

describe("toAbsoluteMediaUrl", () => {
  const baseUrl = "https://cms.example.com";

  it("prefixes a leading-slash relative URL", () => {
    expect(toAbsoluteMediaUrl("/uploads/a.jpg", baseUrl)).toBe(
      "https://cms.example.com/uploads/a.jpg"
    );
  });

  it("inserts a slash when the relative URL has none", () => {
    expect(toAbsoluteMediaUrl("uploads/a.jpg", baseUrl)).toBe(
      "https://cms.example.com/uploads/a.jpg"
    );
  });

  it("passes https URLs through unchanged", () => {
    const url = "https://cdn.example.com/a.jpg";
    expect(toAbsoluteMediaUrl(url, baseUrl)).toBe(url);
  });

  it("passes http URLs through unchanged", () => {
    const url = "http://cdn.example.com/a.jpg";
    expect(toAbsoluteMediaUrl(url, baseUrl)).toBe(url);
  });

  it("passes s3:// URLs through unchanged", () => {
    const url = "s3://my-bucket/a.jpg";
    expect(toAbsoluteMediaUrl(url, baseUrl)).toBe(url);
  });

  it("passes protocol-relative URLs through unchanged", () => {
    const url = "//cdn.example.com/a.jpg";
    expect(toAbsoluteMediaUrl(url, baseUrl)).toBe(url);
  });

  it("passes null through", () => {
    expect(toAbsoluteMediaUrl(null, baseUrl)).toBeNull();
  });

  it("passes undefined through", () => {
    expect(toAbsoluteMediaUrl(undefined, baseUrl)).toBeUndefined();
  });

  it("passes empty string through", () => {
    expect(toAbsoluteMediaUrl("", baseUrl)).toBe("");
  });
});

describe("absolutizeMediaUrls", () => {
  const baseUrl = "https://cms.example.com";

  it("absolutizes url and thumbnailUrl on the row", () => {
    const row = { url: "/uploads/a.jpg", thumbnailUrl: "/uploads/a-thumb.jpg" };
    expect(absolutizeMediaUrls(row, baseUrl)).toEqual({
      url: "https://cms.example.com/uploads/a.jpg",
      thumbnailUrl: "https://cms.example.com/uploads/a-thumb.jpg",
    });
  });

  it("absolutizes nested sizes[*].url", () => {
    const row = {
      url: "/uploads/a.jpg",
      sizes: {
        card: { url: "/uploads/a-card.jpg", width: 400, height: 300 },
        thumb: { url: "/uploads/a-thumb.jpg", width: 100, height: 100 },
      },
    };
    const out = absolutizeMediaUrls(row, baseUrl);
    expect(out.sizes?.card.url).toBe(
      "https://cms.example.com/uploads/a-card.jpg"
    );
    expect(out.sizes?.thumb.url).toBe(
      "https://cms.example.com/uploads/a-thumb.jpg"
    );
    // Non-URL variant fields are preserved verbatim.
    expect(out.sizes?.card.width).toBe(400);
    expect(out.sizes?.thumb.height).toBe(100);
  });

  it("leaves absolute variant URLs untouched (mixed cloud + local)", () => {
    const row = {
      url: "/uploads/a.jpg",
      sizes: {
        local: { url: "/uploads/a-card.jpg" },
        cloud: { url: "https://cdn.example.com/a-card.jpg" },
      },
    };
    const out = absolutizeMediaUrls(row, baseUrl);
    expect(out.sizes?.local.url).toBe(
      "https://cms.example.com/uploads/a-card.jpg"
    );
    expect(out.sizes?.cloud.url).toBe("https://cdn.example.com/a-card.jpg");
  });

  it("preserves sizes: null", () => {
    const row = { url: "/uploads/a.jpg", sizes: null };
    const out = absolutizeMediaUrls(row, baseUrl);
    expect(out.sizes).toBeNull();
  });

  it("omits sizes when input does not have the key", () => {
    const row = { url: "/uploads/a.jpg" };
    const out = absolutizeMediaUrls(row, baseUrl);
    expect("sizes" in out).toBe(false);
  });

  it("does not mutate the input row", () => {
    const row = {
      url: "/uploads/a.jpg",
      thumbnailUrl: "/uploads/a-thumb.jpg",
      sizes: { card: { url: "/uploads/a-card.jpg" } },
    };
    const snapshot = JSON.parse(JSON.stringify(row));
    absolutizeMediaUrls(row, baseUrl);
    expect(row).toEqual(snapshot);
    expect(row.sizes.card.url).toBe("/uploads/a-card.jpg");
  });

  it("preserves unrelated fields on the row", () => {
    const row = {
      id: "abc",
      url: "/uploads/a.jpg",
      filename: "a.jpg",
      altText: "an image",
    };
    const out = absolutizeMediaUrls(row, baseUrl);
    expect(out.id).toBe("abc");
    expect(out.filename).toBe("a.jpg");
    expect(out.altText).toBe("an image");
  });
});

describe("lazy base-URL resolution", () => {
  // Why: env validation can throw in test/build contexts. The pass-through
  // contract for absolute URLs must hold without reaching env.
  it("toAbsoluteMediaUrl does not resolve baseUrl for absolute URLs", () => {
    expect(() =>
      toAbsoluteMediaUrl("https://cdn.example.com/a.jpg")
    ).not.toThrow();
  });

  it("toAbsoluteMediaUrl does not resolve baseUrl for null/undefined/empty", () => {
    expect(() => toAbsoluteMediaUrl(null)).not.toThrow();
    expect(() => toAbsoluteMediaUrl(undefined)).not.toThrow();
    expect(() => toAbsoluteMediaUrl("")).not.toThrow();
  });

  it("absolutizeMediaUrls does not resolve baseUrl when all URLs are absolute", () => {
    const row = {
      url: "https://cdn.example.com/a.jpg",
      thumbnailUrl: "https://cdn.example.com/a-thumb.jpg",
      sizes: {
        card: { url: "https://cdn.example.com/a-card.jpg" },
      },
    };
    expect(() => absolutizeMediaUrls(row)).not.toThrow();
  });

  it("toAbsoluteMediaUrl falls back to the resolver only for relative URLs without explicit base", () => {
    // With the mock throwing, this proves getBaseUrl() *is* the source of
    // truth for the implicit case — confirms we didn't accidentally swap in
    // a silent default.
    expect(() => toAbsoluteMediaUrl("/uploads/a.jpg")).toThrow(/getBaseUrl/);
  });
});

describe("string-encoded sizes (SQLite)", () => {
  // Why: SQLite stores `media.sizes` as TEXT and the better-sqlite3 driver
  // returns it unparsed. Without normalisation, populated media in entry
  // responses leak relative variant URLs even after the top-level url and
  // thumbnailUrl have been absolutized.
  const baseUrl = "https://cms.example.com";

  it("parses a JSON-encoded sizes string and absolutizes variant URLs", () => {
    const row = {
      url: "/uploads/a.jpg",
      sizes: JSON.stringify({
        card: { url: "/uploads/a-card.jpg", width: 400, height: 300 },
        thumb: { url: "/uploads/a-thumb.jpg" },
      }),
    };
    const out = absolutizeMediaUrls(row, baseUrl);
    expect(out.sizes).toEqual({
      card: {
        url: "https://cms.example.com/uploads/a-card.jpg",
        width: 400,
        height: 300,
      },
      thumb: { url: "https://cms.example.com/uploads/a-thumb.jpg" },
    });
    expect(out.url).toBe("https://cms.example.com/uploads/a.jpg");
  });

  it("leaves absolute variant URLs in a parsed string-sizes payload untouched", () => {
    const row = {
      url: "/uploads/a.jpg",
      sizes: JSON.stringify({
        cloud: { url: "https://cdn.example.com/a-card.jpg" },
        local: { url: "/uploads/a-local.jpg" },
      }),
    };
    const out = absolutizeMediaUrls(row, baseUrl);
    // sizes is narrowed to `string` by the input type but normalised to
    // an object at runtime; cast for property access.
    const sizes = out.sizes as unknown as Record<
      string,
      { url: string }
    > | null;
    expect(sizes?.cloud.url).toBe("https://cdn.example.com/a-card.jpg");
    expect(sizes?.local.url).toBe(
      "https://cms.example.com/uploads/a-local.jpg"
    );
  });

  it("normalises unparseable string sizes to null rather than leaking the raw string", () => {
    const row = {
      url: "/uploads/a.jpg",
      sizes: "not-valid-json",
    };
    const out = absolutizeMediaUrls(row, baseUrl);
    expect(out.sizes).toBeNull();
  });

  it("normalises a JSON-encoded non-object (array) to null", () => {
    const row = {
      url: "/uploads/a.jpg",
      sizes: JSON.stringify(["card", "thumb"]),
    };
    const out = absolutizeMediaUrls(row, baseUrl);
    expect(out.sizes).toBeNull();
  });
});
