/**
 * One feed as the site serves it: its channel named as every link to it
 * names it (`feeds/links`), and the items it holds.
 *
 * @module feeds/feed
 */
import type { PluginContext } from "@nextlyhq/plugin-sdk";

import { feedItemsOf, type FeedReading } from "./items";
import { feedTitleOf } from "./links";
import type { CheckedFeed } from "./options";
import { rssFeed } from "./rss";

/** The feed `feed` on `origin`, as RSS 2.0. */
export async function feedXmlOf(
  ctx: PluginContext,
  feed: CheckedFeed,
  reading: FeedReading
): Promise<string> {
  const { origin } = reading;
  const rules = await reading.readRules(ctx, undefined);
  const items = await feedItemsOf(ctx, feed, reading);
  // When what it holds last changed: its newest item's own date, never the
  // time it was asked for, so a reader asking again sees nothing new.
  const dates = items.flatMap(item => {
    const date = item.updated ?? item.published;
    return date === undefined ? [] : [date.getTime()];
  });
  const title = feedTitleOf(feed, rules, origin);
  return rssFeed({
    title,
    link: new URL(feed.link, `${origin}/`).href,
    description: feed.description ?? rules.description ?? title,
    self: new URL(feed.path, `${origin}/`).href,
    language: await ctx.publicAddresses.defaultLanguage(),
    ...(dates.length === 0 ? {} : { lastBuilt: new Date(Math.max(...dates)) }),
    items,
  });
}
