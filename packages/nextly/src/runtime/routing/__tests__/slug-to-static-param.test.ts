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

  it("normalizes to CHECK, and refuses what normalization changed", () => {
    // A leading slash must not smuggle a reserved path past the check, so the
    // normalization still happens. What it must not do is rewrite: the route
    // matches the joined incoming segments against the STORED column, so an
    // entry stored as `a//b` is fetched at `/a/b` and looked up as `a/b` —
    // which it does not have. Pre-rendering that builds a page the lookup can
    // never find, and any URL derived from it names one the route 404s.
    expect(slugToStaticParam("/admin")).toBeNull();
    expect(slugToStaticParam("/blog/post/")).toBeNull();
    expect(slugToStaticParam("a//b")).toBeNull();
    // A slug needing no normalization is unaffected, which is the control that
    // stops the above passing for a function that refuses everything.
    expect(slugToStaticParam("blog/post")).toEqual({ slug: ["blog", "post"] });
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

  it("keeps a slug whose segment literally contains a percent sequence", () => {
    // The URL standard treats `%2e` as a dot when parsing a URL, but this reads
    // a slug as STORED, and stored text reaches a URL already encoded: the
    // segment `%2E%2E` is emitted as `%252E%252E`, which stays literal and
    // decodes back to the text the lookup matches. Applying the URL-text rule
    // here would take an addressable entry out of static generation and strip
    // its canonical.
    expect(slugToStaticParam("pages/%2E%2E/admin")).toEqual({
      slug: ["pages", "%2E%2E", "admin"],
    });
    expect(slugToStaticParam("a/%2E/b")).toEqual({ slug: ["a", "%2E", "b"] });
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
