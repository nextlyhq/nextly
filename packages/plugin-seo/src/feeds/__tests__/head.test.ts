/**
 * The links from a page's head to the site's feeds: a feed shown on every
 * page is linked from each; any other from its own listing page, known by
 * its address or else its canonical, and from each page of a collection it
 * is made from; and none where the options name no feed.
 */
import type {
  PageMetadataAnswer,
  PageMetadataInput,
  PluginContext,
} from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { withFeedLinks } from "../head";
import { checkedFeeds } from "../options";

const ctx = { self: { collections: {} } } as unknown as PluginContext;

const feeds = checkedFeeds({
  site: { path: "/feed.xml", sources: ["posts"] },
  blog: { path: "/blog/feed.xml", title: "Acme blog", sources: ["posts"] },
  changes: {
    path: "/changelog/feed.xml",
    title: "Changes",
    sources: [() => []],
  },
});

const SITE_FEED = { url: "https://acme.example/feed.xml", title: "Acme" };
const BLOG_FEED = {
  url: "https://acme.example/blog/feed.xml",
  title: "Acme blog",
};
const CHANGES_FEED = {
  url: "https://acme.example/changelog/feed.xml",
  title: "Changes",
};

const entry = (collection: string, path?: string): PageMetadataInput => ({
  ...(path === undefined ? {} : { path }),
  source: { kind: "entry", collection, entry: { id: "1" } },
  code: {},
  derived: {},
});

const single = (slug: string, path?: string): PageMetadataInput => ({
  ...(path === undefined ? {} : { path }),
  source: { kind: "single", slug, document: { id: "1" } },
  code: {},
  derived: {},
});

/** The feeds the head of `input` links, its answer `answer`. */
async function linked(
  input: PageMetadataInput,
  answer: PageMetadataAnswer = {},
  options: { feeds?: typeof feeds; productionAddresses?: string[] } = {}
): Promise<PageMetadataAnswer["feeds"]> {
  const resolver = withFeedLinks(
    ctx,
    { resolve: () => answer },
    {
      feeds: options.feeds ?? feeds,
      readRules: async () => ({
        patterns: {},
        siteName: "Acme",
        productionAddresses: options.productionAddresses ?? [
          "https://acme.example",
        ],
      }),
    }
  );
  return (await resolver.resolve(input)).feeds;
}

describe("the links from a page's head to the site's feeds", () => {
  it("link the site's feed from every page, and a stream's feed from the pages it is made from", async () => {
    expect(await linked(entry("posts", "/blog/hello"))).toEqual([
      SITE_FEED,
      BLOG_FEED,
    ]);
    expect(await linked(single("about", "/about"))).toEqual([SITE_FEED]);
    expect(await linked(entry("products", "/products/a"))).toEqual([SITE_FEED]);
  });

  it("link a stream's feed from its listing page, by its address or else its canonical", async () => {
    expect(await linked(single("blog", "/blog/"))).toEqual([
      SITE_FEED,
      BLOG_FEED,
    ]);
    // A Single's route may not know its address: its canonical says it.
    expect(
      await linked(single("changelog"), {
        canonical: "https://acme.example/changelog",
      })
    ).toEqual([SITE_FEED, CHANGES_FEED]);
  });

  it("write each address from the root where the site names no address of its own", async () => {
    expect(
      await linked(single("about", "/about"), {}, { productionAddresses: [] })
    ).toEqual([{ url: "/feed.xml", title: "Acme" }]);
  });

  it("add nothing where the options name no feed, or none belongs to the page", async () => {
    expect(await linked(entry("posts", "/blog/hello"), {}, { feeds: [] })).toBe(
      undefined
    );
    const streamOnly = checkedFeeds({
      blog: { path: "/blog/feed.xml", sources: ["posts"] },
    });
    expect(
      await linked(single("about", "/about"), {}, { feeds: streamOnly })
    ).toBe(undefined);
  });
});
