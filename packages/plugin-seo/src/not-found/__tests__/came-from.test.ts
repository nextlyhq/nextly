/**
 * Where a visitor to an address not found came from, as the log keeps it:
 * another site's host, a path on this site without its query, or nothing
 * for a visitor who came directly. No other site's path and no query is
 * ever kept.
 */
import { describe, expect, it } from "vitest";

import { cameFromOf } from "../report";

const ASKED = new URL("https://example.com/pricing-plans");

describe("cameFromOf", () => {
  it("keeps another site's host only", () => {
    expect(cameFromOf("https://news.example.org/story/123?utm=x", ASKED)).toBe(
      "news.example.org"
    );
  });

  it("keeps a page on this site as its path, without its query", () => {
    expect(
      cameFromOf("https://example.com/blog/launch?ref=nav#top", ASKED)
    ).toBe("/blog/launch");
  });

  it("keeps nothing for a visitor who came directly, or a referer it can't read", () => {
    expect(cameFromOf(null, ASKED)).toBeUndefined();
    expect(cameFromOf("", ASKED)).toBeUndefined();
    expect(cameFromOf("not a url", ASKED)).toBeUndefined();
    expect(cameFromOf("android-app://com.example", ASKED)).toBeUndefined();
  });
});
