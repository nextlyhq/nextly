/**
 * A route's custom CSS: the host's checker joins the page's compile context,
 * with the site's own CSS read once per render. A public route caches that
 * read, tagged with the Singles the source names, so a save of the site's CSS
 * reaches the next page view; a route with no source draws no custom CSS.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  reads: [] as { tags: string[]; keyParts: string[] }[],
}));
vi.mock("nextly/runtime", async importActual => {
  const actual = await importActual<typeof import("nextly/runtime")>();
  return {
    ...actual,
    cachedFind: async (
      read: () => Promise<unknown>,
      options: { tags: string[]; keyParts: string[] }
    ) => {
      runtime.reads.push({ tags: options.tags, keyParts: options.keyParts });
      return read();
    },
    releaseBoundedRevalidate: async () => false,
  };
});

const { routeCustomCss } = await import("./next-custom-css");

beforeEach(() => {
  runtime.reads = [];
});

const source = (site: string | undefined) => ({
  id: "checker-1",
  accepts: (css: string) => !css.includes("@import"),
  readSite: vi.fn(async () => site),
  singles: ["page-builder-site-code"],
});

const route = { collections: ["pages"], field: "content" };

describe("routeCustomCss", () => {
  it("is none when the route names no custom CSS", async () => {
    expect(await routeCustomCss({ ...route }, true, undefined)).toEqual({});
  });

  it("is the host's checker with the site's CSS", async () => {
    const { customCss: policy } = await routeCustomCss(
      { ...route, customCss: source("body { margin: 0; }") },
      false,
      undefined
    );
    expect(policy?.id).toBe("checker-1");
    expect(policy?.site).toBe("body { margin: 0; }");
    expect(policy?.accepts("@import url(/a.css);", "page")).toBe(false);
    expect(policy?.accepts("p { color: red; }", "page")).toBe(true);
  });

  it("carries no site CSS when the site has none", async () => {
    const { customCss: policy } = await routeCustomCss(
      { ...route, customCss: source(undefined) },
      false,
      undefined
    );
    expect(policy).toBeDefined();
    expect(policy).not.toHaveProperty("site");
  });

  it("caches a public route's read, tagged with the Singles it names", async () => {
    const given = source("body { margin: 0; }");
    await routeCustomCss({ ...route, customCss: given }, true, undefined);
    expect(runtime.reads).toHaveLength(1);
    expect(runtime.reads[0]?.tags).toContain(
      "nextly:single:page-builder-site-code"
    );
    expect(given.readSite).toHaveBeenCalledTimes(1);
  });

  it("tags a public route's read with the cache tags the source names too", async () => {
    await routeStyleContext(
      {
        ...route,
        styleContext: BASE,
        customCss: {
          ...source("body { margin: 0; }"),
          singles: [],
          tags: ["nextly:plugin:@acme/builder:site-css"],
        },
      },
      true,
      undefined
    );
    expect(runtime.reads[0]?.tags).toEqual([
      "nextly:plugin:@acme/builder:site-css",
    ]);
    // Named in the cache key too, so two sources' reads never share an entry.
    expect(runtime.reads[0]?.keyParts.join("\n")).toContain(
      "nextly:plugin:@acme/builder:site-css"
    );
  });

  it("reads a draft route's site CSS fresh, uncached", async () => {
    await routeCustomCss(
      { ...route, customCss: source("x{}") },
      false,
      undefined
    );
    expect(runtime.reads).toHaveLength(0);
  });
});
