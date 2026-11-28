/**
 * The items a feed's code sources give: an item whose dates are not dates is
 * left out, or kept without the date that is not one, and never takes the
 * rest of the feed down with it.
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

import { feedItemsOf } from "../items";
import { checkedFeeds, type FeedItem } from "../options";

const SITE = "https://acme.example";

/** A context with what a feed of code sources alone reads: the default language, and a logger. */
function contextOf() {
  const warn = vi.fn();
  const ctx = {
    logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    publicAddresses: { defaultLanguage: async () => "en" },
  } as unknown as PluginContext;
  return { ctx, warn };
}

/** The items a feed made from `items` alone holds. */
async function itemsOf(ctx: PluginContext, items: FeedItem[]) {
  const [feed] = checkedFeeds({
    changes: { path: "/changelog/feed.xml", sources: [() => items] },
  });
  if (feed === undefined) throw new Error("no feed");
  return feedItemsOf(ctx, feed, {
    origin: SITE,
    readRules: async () => ({}) as never,
  });
}

describe("a feed's code sources", () => {
  it("leaves out an item published at a date that is not one, and keeps the rest", async () => {
    const { ctx, warn } = contextOf();
    const items = await itemsOf(ctx, [
      {
        id: "release:broken",
        title: "Broken",
        url: "/changelog#broken",
        published: new Date("not a date"),
      },
      {
        id: "release:1.0.0",
        title: "Version 1.0",
        url: "/changelog#1.0.0",
        published: new Date("2026-11-20T12:00:00Z"),
      },
    ]);
    expect(items.map(item => item.guid)).toEqual([`${SITE}#release:1.0.0`]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("left out"),
      expect.objectContaining({ id: "release:broken" })
    );
  });

  it("keeps an item whose change date is not one, without that date", async () => {
    const { ctx } = contextOf();
    const [item] = await itemsOf(ctx, [
      {
        id: "release:1.1.0",
        title: "Version 1.1",
        url: "/changelog#1.1.0",
        published: "2026-11-21T12:00:00Z",
        updated: new Date(Number.NaN),
      },
    ]);
    expect(item?.published?.toISOString()).toBe("2026-11-21T12:00:00.000Z");
    expect(item).not.toHaveProperty("updated");
  });
});
