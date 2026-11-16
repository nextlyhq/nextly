/**
 * How the SEO tab writes an answer's values: the address as a results page
 * shows it, and text cut where Google cuts it.
 */
import { describe, expect, it } from "vitest";

import {
  absoluteAddress,
  cutAt,
  fileNameOf,
  hostOf,
  resultsAddress,
  shareImageFit,
} from "../display";

describe("an answer's values on screen", () => {
  it("puts a path from the site's root under the site's origin", () => {
    expect(absoluteAddress("https://acme.com/", "/blog/post")).toBe(
      "https://acme.com/blog/post"
    );
    expect(
      absoluteAddress("https://acme.com", "https://es.acme.com/blog")
    ).toBe("https://es.acme.com/blog");
  });

  it("writes an address as a results page does", () => {
    expect(resultsAddress("https://acme.com/blog/surfer-vs-rext")).toBe(
      "https://acme.com › blog › surfer-vs-rext"
    );
    expect(resultsAddress("https://acme.com/")).toBe("https://acme.com");
    expect(resultsAddress("not an address")).toBe("not an address");
  });

  it("cuts text past the limit with a gap and an ellipsis", () => {
    expect(cutAt("short", 60)).toBe("short");
    expect(cutAt("a".repeat(70), 61)).toBe(`${"a".repeat(60)} …`);
  });

  it("names a site by its host, and an image by its file", () => {
    expect(hostOf("https://acme.com")).toBe("acme.com");
    expect(fileNameOf("/media/covers/surfer%20vs.webp?w=10")).toBe(
      "surfer vs.webp"
    );
  });
});

describe("how a share image fits the shared card", () => {
  it("says a picture taller than the card is cut at the top and bottom", () => {
    expect(shareImageFit({ width: 800, height: 600 })).toEqual({
      text: "This 800 × 600 image is cut at the top and bottom to fit. Fix it under Advanced, Share image.",
      fits: false,
      cutTopAndBottom: true,
    });
  });

  it("says a picture wider than the card is cut at the sides", () => {
    expect(shareImageFit({ width: 3000, height: 1000 })).toEqual({
      text: "This 3000 × 1000 image is cut at the sides to fit. Fix it under Advanced, Share image.",
      fits: false,
      cutTopAndBottom: false,
    });
  });

  it("says a picture of the card's shape but smaller is not shown in full", () => {
    expect(shareImageFit({ width: 600, height: 315 })).toEqual({
      text: "This 600 × 315 image is smaller than the 1200 × 630 networks show in full. Fix it under Advanced, Share image.",
      fits: false,
      cutTopAndBottom: false,
    });
  });

  it("says the card's own size, and a larger one of its shape, show in full", () => {
    expect(shareImageFit({ width: 1200, height: 630 })?.text).toBe(
      "The image is 1200 × 630, the size every network shows in full."
    );
    expect(shareImageFit({ width: 2400, height: 1260 })).toEqual({
      text: "The image is 2400 × 1260, a size every network shows in full.",
      fits: true,
      cutTopAndBottom: false,
    });
  });

  it("says nothing of a picture whose size is not known", () => {
    expect(shareImageFit(undefined)).toBeUndefined();
    expect(shareImageFit({ width: 800 })).toBeUndefined();
  });
});
