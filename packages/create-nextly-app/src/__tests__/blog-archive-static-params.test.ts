/**
 * The blog's detail routes (posts, authors, categories and tags) always give the
 * build one param, a placeholder when the site has none yet: Cache Components
 * refuses an empty list, and the category and tag routes learn from it that the
 * page reads the request. The placeholder's page stops before the database only
 * while the build runs: a slug is free text, so a real archive may share the
 * placeholder's slug, and on a request it must render like any other.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  detailStaticParams,
  isBuildPlaceholder,
} from "../../../../templates/blog/src/lib/static-params";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the blog archive's static params", () => {
  it("gives the build one placeholder when there are no archives", () => {
    const params = detailStaticParams([]);
    expect(params).toHaveLength(1);
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    expect(isBuildPlaceholder(params[0].slug)).toBe(true);
  });

  it("gives the real archives, and no placeholder, when there are some", () => {
    expect(detailStaticParams(["news", "__none__"])).toEqual([
      { slug: "news" },
      { slug: "__none__" },
    ]);
  });

  it("treats the placeholder's slug as a real archive on a request", () => {
    const [{ slug }] = detailStaticParams([]);
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    expect(isBuildPlaceholder(slug)).toBe(false);
    vi.stubEnv("NEXT_PHASE", undefined);
    expect(isBuildPlaceholder(slug)).toBe(false);
  });

  it("never treats another slug as the placeholder", () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    expect(isBuildPlaceholder("news")).toBe(false);
  });
});
