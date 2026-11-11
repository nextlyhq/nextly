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
