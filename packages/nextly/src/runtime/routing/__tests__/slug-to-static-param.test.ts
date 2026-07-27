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
});
