/**
 * Which minted URLs the pane will frame, and which it hands to a tab instead.
 *
 * The consequence of getting this wrong is not an error: a cross-origin frame
 * loads, the preview cookie never reaches it, and the site answers with the
 * PUBLISHED page. So the interesting assertions here are the refusals, and each
 * one is paired with the accept that proves the predicate is not simply
 * refusing everything.
 */
import { describe, expect, it } from "vitest";

import { isSameOriginPreview } from "../sameOriginPreview";

const ADMIN = "https://admin.example.com";

describe("isSameOriginPreview", () => {
  it("accepts the same scheme, host and port", () => {
    expect(
      isSameOriginPreview("https://admin.example.com/blog/post", ADMIN)
    ).toBe(true);
  });

  it("accepts a default port written out, because origins normalise it", () => {
    // `https://h:443` and `https://h` are the same origin, and a deployment
    // that spells the port would otherwise lose the pane for no reason.
    expect(
      isSameOriginPreview("https://admin.example.com:443/blog/post", ADMIN)
    ).toBe(true);
  });

  it("refuses a different host on the same site", () => {
    // The over-refusal this is KNOWN to make: the cookie would in fact have
    // worked here, because same-site is broader than same-origin. Deciding
    // same-site needs the public suffix list, which no browser API exposes, and
    // this direction of wrongness costs the pane rather than showing published
    // content in it.
    expect(isSameOriginPreview("https://example.com/blog/post", ADMIN)).toBe(
      false
    );
  });

  it("refuses a different port", () => {
    // The scaffold's own failure mode: admin on 3000, site on 3001.
    expect(
      isSameOriginPreview("https://admin.example.com:8443/blog/post", ADMIN)
    ).toBe(false);
  });

  it("refuses a different scheme", () => {
    expect(
      isSameOriginPreview("http://admin.example.com/blog/post", ADMIN)
    ).toBe(false);
  });

  it("refuses a URL it cannot parse", () => {
    // Reaching this means the mint stopped returning an absolute URL. Guessing
    // "probably fine" is how the silent failure gets in.
    expect(isSameOriginPreview("/blog/post", ADMIN)).toBe(false);
    expect(isSameOriginPreview("", ADMIN)).toBe(false);
  });

  it("refuses opaque origins rather than letting two of them match", () => {
    // `blob:`, `data:` and `file:` all serialise their origin as the STRING
    // "null", so a plain equality would call two unrelated opaque origins the
    // same one.
    expect(isSameOriginPreview("data:text/html,hi", "null")).toBe(false);
  });
});
