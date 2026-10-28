/**
 * The blog's category and tag routes always give the build one param, a
 * placeholder when the site has no archives yet, so the build learns the page
 * reads the request. The placeholder's page stops before the database only
 * while the build runs: a slug is free text, so a real archive may share the
 * placeholder's slug, and on a request it must render like any other.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  archiveStaticParams,
  isArchivePlaceholder,
} from "../../../../templates/blog/src/lib/static-params";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the blog archive's static params", () => {
  it("gives the build one placeholder when there are no archives", () => {
    const params = archiveStaticParams([]);
    expect(params).toHaveLength(1);
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    expect(isArchivePlaceholder(params[0].slug)).toBe(true);
  });

  it("gives the real archives, and no placeholder, when there are some", () => {
    expect(archiveStaticParams(["news", "__none__"])).toEqual([
      { slug: "news" },
      { slug: "__none__" },
    ]);
  });

  it("treats the placeholder's slug as a real archive on a request", () => {
    const [{ slug }] = archiveStaticParams([]);
    vi.stubEnv("NEXT_PHASE", "phase-production-server");
    expect(isArchivePlaceholder(slug)).toBe(false);
    vi.stubEnv("NEXT_PHASE", undefined);
    expect(isArchivePlaceholder(slug)).toBe(false);
  });

  it("never treats another slug as the placeholder", () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    expect(isArchivePlaceholder("news")).toBe(false);
  });
});
