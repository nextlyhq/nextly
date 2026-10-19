/**
 * The URL the media library copies: one that works where it is pasted.
 *
 * @module lib/media-utils.test
 */

import { describe, expect, it } from "vitest";

import { copyableMediaUrl } from "./media-utils";

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
