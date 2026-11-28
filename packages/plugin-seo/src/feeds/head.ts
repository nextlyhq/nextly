/**
 * The links from a page's head to the site's feeds, so a feed reader given
 * the page finds them (`<link rel="alternate" type="application/rss+xml">`):
 * every page links each feed shown on every page, and a feed's own pages
 * link it too, its listing page and each page of a collection it is made
 * from. Placed in the head's metadata, which Next.js writes into the first
 * HTML for the crawlers `nextlyHtmlLimitedBots` names, not only streamed.
 *
 * @module feeds/head
 */
import type {
  PageMetadataInput,
  PageMetadataResolver,
  PluginContext,
} from "@nextlyhq/plugin-sdk";

import { siteOriginFor } from "../outputs/site-origin";
import { overAnswer, type ReadRules } from "../resolver/provider";

import { feedLinksOf } from "./links";
import type { CheckedFeed } from "./options";

/** A path with its trailing slash taken off, so `/blog` and `/blog/` read alike. */
const bare = (path: string): string =>
  path.length > 1 ? path.replace(/\/+$/, "") : path;

/** The path of an address, whole or from the root; none where it is not one. */
function pathOf(address: string | undefined): string | undefined {
  if (address === undefined) return undefined;
  try {
    return new URL(address, "http://site.invalid").pathname;
  } catch {
    return undefined;
  }
}

/**
 * Whether the page `input` asks about is one of `feed`'s own: its listing
 * page, known by the address its route served it at or else by its
 * canonical (a Single's route may not know its own address), or a page of a
 * collection the feed is made from.
 */
function ownPage(
  feed: CheckedFeed,
  input: PageMetadataInput,
  canonical: string | undefined
): boolean {
  const at = input.path ?? pathOf(canonical);
  if (at !== undefined && bare(at) === bare(feed.link)) return true;
  return (
    input.source.kind === "entry" &&
    feed.collections.includes(input.source.collection)
  );
}

/**
 * `resolver` with the links to the site's feeds added to each page's head
 * where the options name any: each feed's name and its address
 * (`feedLinksOf`), whole on the site's own address where one is named.
 * Read from the options and the site's name, which the settings' cache tags
 * already expire.
 */
export function withFeedLinks(
  ctx: PluginContext,
  resolver: PageMetadataResolver,
  config: {
    feeds: readonly CheckedFeed[];
    readRules: ReadRules;
    origin?: string;
  }
): PageMetadataResolver {
  if (config.feeds.length === 0) return resolver;
  return overAnswer(resolver, async (answer, input) => {
    const linked = config.feeds.filter(
      feed => feed.everyPage || ownPage(feed, input, answer.canonical)
    );
    if (linked.length === 0) return answer;
    const rules = await config.readRules(ctx, input.locale);
    const origin = await siteOriginFor(undefined, ctx, config);
    return { ...answer, feeds: feedLinksOf(linked, rules, origin) };
  });
}
