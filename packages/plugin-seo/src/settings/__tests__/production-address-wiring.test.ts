/**
 * The production address saved in the SEO settings is what the plugin's own
 * staging guard and sitemap read, as the page's head does: one answer for
 * every output, with `NEXTLY_PRODUCTION_ADDRESSES` still winning.
 */
import type {
  PluginContext,
  PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The settings as stored, which each test sets. */
let saved: Record<string, unknown> = {};

vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  getCachedNextly: async () => ({ findSingle: async () => saved }),
}));

import { PRODUCTION_ADDRESSES_ENV } from "../../canonical";
import { seoPlugin } from "../../plugin";

afterEach(() => {
  vi.unstubAllEnvs();
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
    const [guard] = seoPlugin({ collections: ["posts"] }).contributes?.proxy ?? [];

    expect(
      await guard?.handle(new Request("https://copy.acme.example/"), ctx)
    ).toEqual({ headers: { "X-Robots-Tag": "noindex" } });
    expect(
      await guard?.handle(new Request("https://acme.example/"), ctx)
    ).toBeUndefined();
  });

  it("is what the sitemap judges a canonical on another of the site's addresses by", async () => {
    saved = { productionAddresses: ["https://acme.example", "https://acme.de"] };
    const route = seoPlugin({
      collections: ["posts"],
      baseUrl: "https://acme.example",
    }).contributes?.routes?.find(each => each.path === "/sitemap.xml");

    const response = await route?.handler(
      new Request("https://acme.example/sitemap.xml"),
      ctx as PluginRouteContext
    );

    // The canonical is on acme.de, one of the site's addresses: its sitemap
    // lists the page, so this one leaves it out.
    expect(await response?.text()).not.toContain("<loc>");
  });

  it("gives way to the environment's addresses in the sitemap too", async () => {
    vi.stubEnv(PRODUCTION_ADDRESSES_ENV, "https://acme.example");
    saved = { productionAddresses: ["https://acme.example", "https://acme.de"] };
    const route = seoPlugin({
      collections: ["posts"],
      baseUrl: "https://acme.example",
    }).contributes?.routes?.find(each => each.path === "/sitemap.xml");

    const response = await route?.handler(
      new Request("https://acme.example/sitemap.xml"),
      ctx as PluginRouteContext
    );

    // Only acme.example is the site's: acme.de is off it, so the page is
    // listed at its own address.
    expect(await response?.text()).toContain(
      "<loc>https://acme.example/posts/a</loc>"
    );
  });
});
