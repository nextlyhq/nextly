/**
 * What the SEO settings save is what the plugin's own outputs read, as the
 * page's head does: the production address for the staging guard and the
 * sitemap robots.txt names, and the AI crawler choice for robots.txt, with
 * the plugin's options answering until the site has chosen.
 */
import type { PluginContext, PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The settings as stored, which each test sets. */
let saved: Record<string, unknown> = {};

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  getCachedNextly: async () => ({ findSingle: async () => saved }),
}));

import { seoPlugin } from "../../plugin";

/** The plugin's robots.txt route, as `options` declare it. */
function robotsRoute(options: Parameters<typeof seoPlugin>[0]) {
  return seoPlugin(options).contributes?.routes?.find(
    each => each.path === "/robots.txt"
  );
}

/** The robots.txt the plugin serves under `options` to the site's own host. */
async function robotsBody(
  options: Parameters<typeof seoPlugin>[0]
): Promise<string | undefined> {
  const response = await robotsRoute(options)?.handler(
    new Request("https://acme.example/robots.txt"),
    ctx as PluginRouteContext
  );
  return response?.text();
}

afterEach(() => {
  saved = {};
});

/** A context whose site has saved its settings and decided it is listed. */
const ctx = {
  self: { singles: {}, collections: {} },
  user: null,
  services: {
    ownCollections: {
      listEntries: async () => ({ data: [{ id: "m1", path: "listable" }] }),
    },
    media: { findById: async () => undefined },
    collections: {
      getCollection: async () => ({ status: true }),
      listEntries: async () => ({
        data: [{ slug: "a", seo: { canonical: "https://acme.de/a" } }],
        pagination: { hasMore: false },
      }),
    },
  },
} as unknown as PluginContext;

describe("the saved production address", () => {
  it("is what the staging guard keeps every other host out of search by", async () => {
    saved = { productionAddresses: ["https://acme.example"] };
    const [guard] =
      seoPlugin({ collections: ["posts"] }).contributes?.proxy ?? [];

    expect(
      await guard?.handle(new Request("https://copy.acme.example/"), ctx)
    ).toEqual({ headers: { "X-Robots-Tag": "noindex" } });
    expect(
      await guard?.handle(new Request("https://acme.example/"), ctx)
    ).toBeUndefined();
  });

  it("is the address robots.txt names the sitemap at", async () => {
    saved = { productionAddresses: ["https://acme.example"] };
    const robots = robotsRoute({ collections: ["posts"] });

    const body = await (
      await robots?.handler(
        new Request("https://copy.acme.example/robots.txt"),
        ctx as PluginRouteContext
      )
    )?.text();

    expect(body).toContain("Sitemap: https://acme.example/sitemap.xml");
  });
});

describe("the saved AI crawler choice", () => {
  it("is what robots.txt asks AI crawlers, over the plugin's option", async () => {
    saved = { aiCrawlers: "block" };
    const body = await robotsBody({
      collections: ["posts"],
      aiCrawlers: "all",
    });

    expect(body).toContain("User-agent: GPTBot\nDisallow: /");
    expect(body).toContain("User-agent: PerplexityBot\nDisallow: /");
  });

  it("leaves the plugin's option in force until the site chooses", async () => {
    saved = {};
    const body = await robotsBody({
      collections: ["posts"],
      aiCrawlers: "search",
    });

    expect(body).toContain("User-agent: GPTBot\nDisallow: /");
    expect(body).not.toContain("User-agent: PerplexityBot");
  });
});
