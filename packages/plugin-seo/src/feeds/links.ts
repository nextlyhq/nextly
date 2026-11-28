/**
 * The links to the site's feeds: the one place a feed's name and address are
 * worked out, so the feed itself, every page's head and llms.txt name each
 * feed alike.
 *
 * @module feeds/links
 */
import type { SiteRules } from "../resolver/page-levels";

import type { CheckedFeed } from "./options";

/** A feed as a link names it: its name, and its address. */
export interface FeedLink {
  title: string;
  url: string;
}

/**
 * The feed's name: its own, else the site's, else the host of the site's
 * address, else "Feed" where no address is known.
 */
export function feedTitleOf(
  feed: CheckedFeed,
  rules: Pick<SiteRules, "siteName">,
  origin: string | undefined
): string {
  return (
    feed.title ??
    rules.siteName ??
    (origin === undefined ? "Feed" : new URL(origin).host)
  );
}

/**
 * Each of `feeds` as a link, by its name and its address: whole on
 * `origin`, else from the site's root where no address is known, which a
 * page's `metadataBase` makes whole.
 */
export function feedLinksOf(
  feeds: readonly CheckedFeed[],
  rules: Pick<SiteRules, "siteName">,
  origin: string | undefined
): FeedLink[] {
  return feeds.map(feed => ({
    title: feedTitleOf(feed, rules, origin),
    url:
      origin === undefined ? feed.path : new URL(feed.path, `${origin}/`).href,
  }));
}
