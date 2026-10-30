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
  refuseReservedSlug,
} from "../../../../templates/blog/src/lib/static-params";
import { Posts } from "../../../../templates/blog/src/collections/Posts/index";

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

describe("a post's slug field", () => {
  it("is validated by the refusal", () => {
    // `nextly` here is the suite's stub, whose builders pass the config through.
    const slug = (
      Posts.fields as Array<{ name?: string; validate?: unknown }>
    ).find(field => field.name === "slug");
    expect(slug?.validate).toBe(refuseReservedSlug);
  });

  it("refuses the placeholder's slug, which the build stored as not found", () => {
    const [{ slug }] = detailStaticParams([]);
    expect(refuseReservedSlug(slug)).toBe(
      "This slug is reserved by the template; choose another"
    );
  });

  it("accepts every other slug as before, a hand-typed non-ASCII one included", () => {
    for (const slug of [
      "hello-world",
      "Release_Notes.v2",
      "café-à-paris",
      "日本語",
    ]) {
      expect(refuseReservedSlug(slug)).toBe(true);
    }
    expect(refuseReservedSlug(undefined)).toBe(true);
  });
});
