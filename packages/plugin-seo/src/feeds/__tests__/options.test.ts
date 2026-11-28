/**
 * The feeds the plugin's options name: checked when the site starts, so an
 * address `withNextly` does not send to the plugin, a feed with nothing in
 * it or two feeds at one address fail at boot, with each default filled.
 */
import { describe, expect, it } from "vitest";

import { checkedFeeds, type FeedOption } from "../options";

const items = () => [];

describe("the feeds the options name", () => {
  it("are none where the options name none", () => {
    expect(checkedFeeds(undefined)).toEqual([]);
  });

  it("fill each default: the listing page is the feed's folder, 20 items, and only /feed.xml on every page", () => {
    const [site, blog] = checkedFeeds({
      site: { path: "/feed.xml", sources: ["posts", items] },
      blog: { path: "/blog/feed.xml", title: "Acme blog", sources: ["posts"] },
    });
    expect(site).toEqual({
      name: "site",
      path: "/feed.xml",
      link: "/",
      collections: ["posts"],
      code: [items],
      limit: 20,
      everyPage: true,
    });
    expect(blog).toMatchObject({
      path: "/blog/feed.xml",
      title: "Acme blog",
      link: "/blog",
      everyPage: false,
    });
    expect(
      checkedFeeds({
        blog: {
          path: "/blog/feed.xml",
          sources: ["posts"],
          link: "/journal",
          limit: 50,
          everyPage: true,
        },
      })[0]
    ).toMatchObject({ link: "/journal", limit: 50, everyPage: true });
  });

  it.each<[string, FeedOption, string]>([
    [
      "two folders deep",
      { path: "/blog/2026/feed.xml", sources: ["posts"] },
      '"bad".path',
    ],
    ["another name", { path: "/rss.xml", sources: ["posts"] }, '"bad".path'],
    [
      "no leading slash",
      { path: "feed.xml", sources: ["posts"] },
      '"bad".path',
    ],
    ["no source", { path: "/feed.xml", sources: [] }, "at least one source"],
    [
      "a slug that is none",
      { path: "/feed.xml", sources: ["Blog Posts"] },
      '"bad".sources.0',
    ],
    [
      "too few items",
      { path: "/feed.xml", sources: ["posts"], limit: 9 },
      '"bad".limit',
    ],
    [
      "too many items",
      { path: "/feed.xml", sources: ["posts"], limit: 51 },
      '"bad".limit',
    ],
    [
      "a listing page that is no path",
      { path: "/feed.xml", sources: ["posts"], link: "blog" },
      '"bad".link',
    ],
  ])("refuse a feed with %s", (_case, option, named) => {
    expect(() => checkedFeeds({ bad: option })).toThrow(named);
  });

  it("refuse two feeds at one address", () => {
    expect(() =>
      checkedFeeds({
        one: { path: "/feed.xml", sources: ["posts"] },
        two: { path: "/feed.xml", sources: ["pages"] },
      })
    ).toThrow('"two" and "one" are both served at /feed.xml');
  });
});
