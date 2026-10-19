/**
 * The stored path of a file uploaded beside a media item's original, worked
 * out from the original's stored path and URL.
 */
import { describe, expect, it } from "vitest";

import { siblingStoredPath } from "../stored-path";

const BLOB = "https://abc123.public.blob.vercel-storage.com";

describe("siblingStoredPath", () => {
  it("takes the prefix the original shows off the file's URL", () => {
    expect(
      siblingStoredPath(
        { path: "2026/10/a1-x.png", url: "/uploads/2026/10/a1-x.png" },
        "/uploads/2026/10/b2-thumb_x.png"
      )
    ).toBe("2026/10/b2-thumb_x.png");
  });

  // Vercel Blob stores an SVG for download, recording as its URL the blob's
  // own URL with `?download=1`, while its stored path is the blob's URL.
  it("reads a URL by its address, without the query an attachment adds", () => {
    expect(
      siblingStoredPath(
        { path: `${BLOB}/x-a1.svg`, url: `${BLOB}/x-a1.svg?download=1` },
        `${BLOB}/thumb_x-b2.png`
      )
    ).toBe(`${BLOB}/thumb_x-b2.png`);
    expect(
      siblingStoredPath(
        { path: `${BLOB}/x-a1.svg`, url: `${BLOB}/x-a1.svg?download=1` },
        `${BLOB}/thumb_x-b2.svg?download=1`
      )
    ).toBe(`${BLOB}/thumb_x-b2.svg`);
  });

  it("guesses nothing where the original's URL does not end with its path", () => {
    expect(
      siblingStoredPath(
        { path: "2026/10/a1-x.png", url: "https://elsewhere.example/a1-x.png" },
        "https://elsewhere.example/2026/10/b2-thumb_x.png"
      )
    ).toBeUndefined();
  });
});
