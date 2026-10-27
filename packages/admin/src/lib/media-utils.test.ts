/**
 * The URL the media library copies: one that works where it is pasted. And
 * the image a library tile draws: the smallest stored copy that still shows
 * the whole picture, never a cropped one.
 *
 * @module lib/media-utils.test
 */

import { describe, expect, it } from "vitest";

import type { ImageSizeVariant } from "@admin/types/media";

import { copyableMediaUrl, mediaImageSrc } from "./media-utils";

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

describe("mediaImageSrc for a tile", () => {
  const tile = { purpose: "tile" } as const;

  it("takes the smallest size that shows the whole image", () => {
    expect(
      mediaImageSrc(
        wide({
          large: variant("large", 1024, 427),
          small: variant("small", 480, 200),
        }),
        tile
      )
    ).toBe("/uploads/small.jpg");
  });

  it("never picks a size cropped to other proportions", () => {
    expect(
      mediaImageSrc(
        wide({
          // A square cut from a wide photo: smaller, and missing its sides.
          card: variant("card", 300, 300),
          medium: variant("medium", 768, 320),
        }),
        tile
      )
    ).toBe("/uploads/medium.jpg");
  });

  it("takes the thumbnail, centre crop and all, when no size shows the whole image", () => {
    // No sizes at all is what an install starts with: the original would
    // make every tile of a page download a full photo.
    expect(mediaImageSrc(wide(null), tile)).toBe("/uploads/thumb.jpg");
    expect(mediaImageSrc(wide({ card: variant("card", 300, 300) }), tile)).toBe(
      "/uploads/thumb.jpg"
    );
  });

  it("takes the original only when there is no thumbnail either", () => {
    expect(mediaImageSrc({ ...wide(null), thumbnailUrl: null }, tile)).toBe(
      "/uploads/original.jpg"
    );
  });

  it("reads sizes an adapter returned as a JSON string", () => {
    const sizes = JSON.stringify({ small: variant("small", 480, 200) });
    expect(mediaImageSrc({ ...wide(null), sizes }, tile)).toBe(
      "/uploads/small.jpg"
    );
  });
});

describe("mediaImageSrc for a preview", () => {
  it("takes the original, whatever smaller sizes exist", () => {
    // The panel and the viewer show one image at a time, and must show it
    // whole and sharp.
    expect(
      mediaImageSrc(wide({ small: variant("small", 480, 200) }), {
        purpose: "preview",
      })
    ).toBe("/uploads/original.jpg");
  });
});
