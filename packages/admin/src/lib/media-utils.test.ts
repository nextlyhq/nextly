/**
 * The URL the media library copies: one that works where it is pasted. And
 * the image a library tile draws: the smallest stored copy that still shows
 * the whole picture, never a cropped one.
 *
 * @module lib/media-utils.test
 */

import { describe, expect, it } from "vitest";

import type { ImageSizeVariant } from "@admin/types/media";

import { copyableMediaUrl, wholeImageSrc } from "./media-utils";

describe("copyableMediaUrl", () => {
  // Local storage serves a path, which a page resolves on its own host but an
  // email or another application cannot.
  it("makes a path absolute on the page's own origin", () => {
    expect(copyableMediaUrl("/uploads/2026/10/a.png")).toBe(
      `${window.location.origin}/uploads/2026/10/a.png`
    );
  });

  it("leaves an absolute storage URL as it is", () => {
    const url = "https://bucket.s3.eu-west-1.amazonaws.com/2026/10/a.png";
    expect(copyableMediaUrl(url)).toBe(url);
  });
});

function variant(
  name: string,
  width: number,
  height: number
): ImageSizeVariant {
  return {
    url: `/uploads/${name}.jpg`,
    path: `${name}.jpg`,
    width,
    height,
    filesize: width * height,
    mimeType: "image/jpeg",
    filename: `${name}.jpg`,
  };
}

/** A 1920 by 800 photo, its square thumbnail, and whatever sizes a case adds. */
function wide(sizes: Record<string, ImageSizeVariant> | null) {
  return {
    url: "/uploads/original.jpg",
    thumbnailUrl: "/uploads/thumb.jpg",
    width: 1920,
    height: 800,
    sizes,
  };
}

describe("wholeImageSrc", () => {
  it("prefers the smallest size fitted inside the image over the original", () => {
    expect(
      wholeImageSrc(
        wide({
          large: variant("large", 1024, 427),
          small: variant("small", 480, 200),
        })
      )
    ).toBe("/uploads/small.jpg");
  });

  it("never picks a cropped size, however small", () => {
    expect(
      wholeImageSrc(
        wide({
          // A square cut from a wide photo: smaller, and missing its sides.
          card: variant("card", 300, 300),
          medium: variant("medium", 768, 320),
        })
      )
    ).toBe("/uploads/medium.jpg");
  });

  it("falls back to the original when no stored size shows the whole image", () => {
    expect(wholeImageSrc(wide({ card: variant("card", 300, 300) }))).toBe(
      "/uploads/original.jpg"
    );
    expect(wholeImageSrc(wide(null))).toBe("/uploads/original.jpg");
  });

  it("reads sizes an adapter returned as a JSON string", () => {
    const sizes = JSON.stringify({ small: variant("small", 480, 200) });
    expect(wholeImageSrc({ ...wide(null), sizes })).toBe("/uploads/small.jpg");
  });

  it("uses the square thumbnail for a square image with no smaller fitted size", () => {
    expect(wholeImageSrc({ ...wide(null), width: 1200, height: 1200 })).toBe(
      "/uploads/thumb.jpg"
    );
  });
});
