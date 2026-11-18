/**
 * A route's custom CSS: the host's checker joins the page's compile context,
 * with the site's own CSS read once per render. A public route caches that
 * read, tagged with the Singles the source names, so a save of the site's CSS
 * reaches the next page view; a route with no source draws no custom CSS.
 */
import type { StyleCompileContext } from "@nextlyhq/blocks-engine";
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

const { routeStyleContext } = await import("./next-custom-css");

beforeEach(() => {
  runtime.reads = [];
});

const BASE: StyleCompileContext = {
  breakpoints: { viewport: [], container: [] },
};

const source = (site: string | undefined) => ({
  id: "checker-1",
  accepts: (css: string) => !css.includes("@import"),
  readSite: vi.fn(async () => site),
  singles: ["page-builder-site-code"],
});

const route = { collections: ["pages"], field: "content" };

describe("routeStyleContext", () => {
  it("is the route's own context when it names no custom CSS", async () => {
    expect(
      await routeStyleContext({ ...route, styleContext: BASE }, true, undefined)
    ).toBe(BASE);
  });

  it("gives the compile the host's checker and the site's CSS", async () => {
    const given = source("body { margin: 0; }");
    const context = await routeStyleContext(
      { ...route, styleContext: BASE, customCss: given },
      false,
      undefined
    );
    expect(context?.breakpoints).toBe(BASE.breakpoints);
    expect(context?.customCss?.id).toBe("checker-1");
    expect(context?.customCss?.site).toBe("body { margin: 0; }");
    expect(context?.customCss?.accepts("@import url(/a.css);", "page")).toBe(
      false
    );
    expect(context?.customCss?.accepts("p { color: red; }", "page")).toBe(true);
  });

  it("carries no site CSS when the site has none", async () => {
    const context = await routeStyleContext(
      { ...route, styleContext: BASE, customCss: source(undefined) },
      false,
      undefined
    );
    expect(context?.customCss).toBeDefined();
    expect(context?.customCss).not.toHaveProperty("site");
  });

  it("caches a public route's read, tagged with the Singles it names", async () => {
    const given = source("body { margin: 0; }");
    await routeStyleContext(
      { ...route, styleContext: BASE, customCss: given },
      true,
      undefined
    );
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
    await routeStyleContext(
      { ...route, styleContext: BASE, customCss: source("x{}") },
      false,
      undefined
    );
    expect(runtime.reads).toHaveLength(0);
  });

  it("compiles nothing it was not given a context for", async () => {
    expect(
      await routeStyleContext(
        { ...route, customCss: source("x{}") },
        false,
        undefined
      )
    ).toBeUndefined();
  });
});
