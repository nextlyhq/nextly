/**
 * `slugToStaticParam` maps a stored slug to a static-params entry: an empty
 * slug becomes the root (`{ slug: [] }`), nested slugs split on `/`, and
 * whitespace-only, non-string, or reserved values are skipped.
 */
import { describe, expect, it } from "vitest";

import { slugToStaticParam } from "../content-route";

describe("slugToStaticParam", () => {
  it("emits the no-segment root param for an empty slug", () => {
    expect(slugToStaticParam("")).toEqual({ slug: [] });
  });

  it("splits a nested slug into segments", () => {
    expect(slugToStaticParam("blog/post")).toEqual({ slug: ["blog", "post"] });
  });

  it("keeps a single-segment slug", () => {
    expect(slugToStaticParam("about")).toEqual({ slug: ["about"] });
  });

  it("skips whitespace-only, non-string, and reserved values", () => {
    expect(slugToStaticParam("   ")).toBeNull();
    expect(slugToStaticParam(42)).toBeNull();
    expect(slugToStaticParam(null)).toBeNull();
    expect(slugToStaticParam("admin")).toBeNull();
    expect(slugToStaticParam("api/keys")).toBeNull();
  });

  it("normalizes redundant slashes and still rejects a slash-prefixed reserved slug", () => {
    // A leading slash must not smuggle a reserved path past the check.
    expect(slugToStaticParam("/admin")).toBeNull();
    // Edge/duplicate slashes collapse to clean segments.
    expect(slugToStaticParam("/blog/post/")).toEqual({
      slug: ["blog", "post"],
    });
    expect(slugToStaticParam("a//b")).toEqual({ slug: ["a", "b"] });
  });

  it("rejects a slug holding a segment URL resolution removes", () => {
    // Pre-rendering `/pages/../admin` produces a page nothing can reach: the
    // request is normalized before it is sent, so it arrives asking for
    // `/admin` — a different, possibly reserved route. The `.` case is the same
    // rule and removes a segment too.
    expect(slugToStaticParam("pages/../admin")).toBeNull();
    expect(slugToStaticParam("a/./b")).toBeNull();
    expect(slugToStaticParam("..")).toBeNull();
  });

  it("rejects the percent-encoded spelling of a dot segment", () => {
    // Encoding does not make the segment literal: the URL standard defines a
    // double-dot segment as any casing of `..`, `.%2e`, `%2e.` or `%2e%2e`, so
    // `/pages/%2E%2E/admin` resolves to `/admin` exactly as the bare form does.
    expect(slugToStaticParam("pages/%2E%2E/admin")).toBeNull();
    expect(slugToStaticParam("pages/%2e%2e/admin")).toBeNull();
    expect(slugToStaticParam("pages/.%2e/admin")).toBeNull();
    expect(slugToStaticParam("a/%2E/b")).toBeNull();
  });

  it("keeps a segment that merely CONTAINS dots", () => {
    // Only a segment that is entirely dots is removed. A file-like slug is an
    // ordinary path, and rejecting it would strip real pages from the sitemap.
    expect(slugToStaticParam("docs/v1.2/guide")).toEqual({
      slug: ["docs", "v1.2", "guide"],
    });
    expect(slugToStaticParam("...")).toEqual({ slug: ["..."] });
  });
});
