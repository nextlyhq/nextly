/**
 * The URL the media library copies: one that works where it is pasted. And
 * the image a library tile draws: the stored thumbnail, and the original only
 * when there is none.
 *
 * @module lib/media-utils.test
 */

import { describe, expect, it } from "vitest";

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

/**
 * A 1920 by 800 photo and its thumbnail, as the server sends an item. An item
 * uploaded before image sizes were removed held sizes too; one is added here
 * the way an older response carried it, to show it is not drawn from.
 */
function wide() {
  return {
    url: "/uploads/original.jpg",
    thumbnailUrl: "/uploads/thumb.jpg",
    width: 1920,
    height: 800,
    ...({
      sizes: {
        small: {
          url: "/uploads/small.jpg",
          path: "small.jpg",
          width: 480,
          height: 200,
        },
      },
    } as object),
  };
}

describe("mediaImageSrc for a tile", () => {
  const tile = { purpose: "tile" } as const;

  it("takes the stored thumbnail, whatever sizes an older item carried", () => {
    // The thumbnail is the whole image fitted inside 480 by 480, or for an
    // older item a square: the tile draws either whole, so it is the one
    // light copy a page of many needs.
    expect(mediaImageSrc(wide(), tile)).toBe("/uploads/thumb.jpg");
  });

  it("takes the original only when there is no thumbnail", () => {
    expect(mediaImageSrc({ ...wide(), thumbnailUrl: null }, tile)).toBe(
      "/uploads/original.jpg"
    );
  });
});

describe("mediaImageSrc for a preview", () => {
  it("takes the original", () => {
    // The panel and the viewer show one image at a time, and must show it
    // whole and sharp.
    expect(mediaImageSrc(wide(), { purpose: "preview" })).toBe(
      "/uploads/original.jpg"
    );
  });
});
