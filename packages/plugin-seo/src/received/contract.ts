/**
 * What Inspect and its route agree on: where the check is, the crawlers a
 * page is fetched as and the limits each fetch is held to, and the shape of
 * what the check answers. It imports only other contracts and types, so the
 * admin bundle reads it without the server's code.
 *
 * @module received/contract
 */
import { INSPECT_PAGE_HREF } from "../overview/contract";
import type { SeoLevel } from "../resolver/order";
import type { AiCrawlerChoice } from "../settings/contract";

/** Where a page is checked, under the plugin's routes. */
export const RECEIVED_ROUTE_PATH = "/received";

/**
 * The screen's old address: its path under the plugin, and the component
 * that sends a bookmark on to Inspect, or to Pages.
 */
export const RECEIVED_PAGE: {
  readonly path: "received";
  readonly component: "@nextlyhq/plugin-seo/admin#SeoReceivedMoved";
} = {
  path: "received",
  component: "@nextlyhq/plugin-seo/admin#SeoReceivedMoved",
};

/** Names joined for a sentence: "a", "a and b", "a, b and c". */
export function inSentence(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/** The last part of an image's address, which names its file. */
export function fileOf(address: string): string {
  try {
    const path = new URL(address).pathname;
    return decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)) || address;
  } catch {
    return address;
  }
}

/**
 * Where the page at `address` is checked: Inspect, under Pages, which took
 * over this screen's old address.
 */
export function receivedHrefFor(address: string): string {
  return `${INSPECT_PAGE_HREF}?address=${encodeURIComponent(address)}`;
}

/**
 * The crawlers a page is fetched as, in the order they are shown, and what
 * each reads: the page's own title and description, as a search engine or an
 * AI crawler does, or the shared card's, as a social network does.
 */
export const CRAWLERS = [
  {
    key: "googlebot",
    name: "Google",
    reads: "page",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/131.0.0.0 Safari/537.36",
  },
  {
    key: "bingbot",
    name: "Bing",
    reads: "page",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/131.0.0.0 Safari/537.36",
  },
  {
    key: "facebook",
    name: "Facebook",
    reads: "card",
    userAgent:
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  },
  { key: "x", name: "X", reads: "card", userAgent: "Twitterbot/1.0" },
  {
    key: "linkedin",
    name: "LinkedIn",
    reads: "card",
    userAgent:
      "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
  },
  {
    key: "ai",
    name: "AI crawlers",
    reads: "page",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
  },
] as const;

/** One of the crawlers, by key. */
export type CrawlerKey = (typeof CRAWLERS)[number]["key"];

/** The crawlers the Head table can be compared with, in its order. */
export const HEAD_CRAWLERS: readonly CrawlerKey[] = [
  "googlebot",
  "facebook",
  "x",
  "linkedin",
];

/** Each crawler's name, by key. */
export const CRAWLER_NAMES: Readonly<Record<CrawlerKey, string>> =
  Object.fromEntries(
    CRAWLERS.map(crawler => [crawler.key, crawler.name])
  ) as Record<CrawlerKey, string>;

/**
 * The rows the screen compares, in the order the Head table lists them,
 * each named by the tag it is served in.
 */
export const RECEIVED_ROWS = [
  { key: "title", tag: "title" },
  { key: "description", tag: "description" },
  { key: "canonical", tag: "canonical" },
  { key: "robots", tag: "robots" },
  { key: "image", tag: "og:image" },
  { key: "locale", tag: "og:locale" },
  { key: "siteName", tag: "og:site_name" },
] as const;

/** One of the rows, by key. */
export type RowKey = (typeof RECEIVED_ROWS)[number]["key"];

/** What one crawler received for one row, beside what Nextly holds. */
export type ReceivedCell =
  /** What Nextly holds; `note` says how this crawler uses or shows it. */
  | { kind: "same"; note?: string }
  /** Not what Nextly holds: `difference` is its number in the list. */
  | { kind: "different"; difference: number; received?: string }
  /** What the crawler received, where Nextly holds no page to compare. */
  | { kind: "received"; received?: string }
  /** A value this crawler does not read. */
  | { kind: "not-used" }
  /** The crawler received no page to read it from. */
  | { kind: "none" };

/** What one crawler was answered. */
export interface CrawlerResult {
  key: CrawlerKey;
  name: string;
  /** The page's status, where one was received. */
  status?: number;
  /** How long the fetch took, in milliseconds. */
  ms: number;
  /** Whether a redirect led to the page that was read. */
  redirected: boolean;
  /** Why nothing was received, where nothing was. */
  failure?: string;
  /** What stopped the fetch, where something did. */
  reason?: FetchStop;
  /** The number of the difference explaining what it was answered. */
  difference?: number;
}

/** A difference, said in plain words, with the action that helps, if any. */
export interface ReceivedDifference {
  number: number;
  title: string;
  text: string;
  /**
   * Expected, nothing to fix: a saved copy the host served, or a value Nextly
   * worked out that the page's design or route rightly sets itself.
   */
  expected?: boolean;
  action?: { label: string; href: string };
}

/**
 * Why a fetch stopped: the address, or a redirect, is one Inspect never
 * fetches (`no-site` to `private`); or the fetch ran into one of its limits,
 * or the site didn't answer.
 */
export type FetchStop =
  | "no-site"
  | "not-an-address"
  | "scheme"
  | "credentials"
  | "other-site"
  | "port"
  | "private"
  | "too-slow"
  | "too-large"
  | "too-many-redirects"
  | "no-answer"
  | "unreachable";

/** Where one of the stored values comes from: the level of the order that gave it. */
export interface ValueOrigin {
  level: SeoLevel;
  /** The pattern a value was made from, where one gave it. */
  pattern?: string;
  /** The page's own field a value was taken from, where one gave it. */
  field?: string;
}

/** What Nextly holds for the page, as the screen shows it. */
export interface StoredValues {
  title?: string;
  description?: string;
  image?: { url: string; width?: number; height?: number };
  canonical?: string;
  /** Whether the page is listed in search, and its links followed. */
  listed: boolean;
  followed: boolean;
  /** The language the card states, such as `en_US`. */
  locale?: string;
  /** The site's name, as the card states it. */
  siteName?: string;
  /** Where each value comes from, where the order says. */
  from: Partial<Record<RowKey, ValueOrigin>>;
}

/** The structured data Nextly gives the page, as the screen lists it. */
export interface HeldStructuredData {
  /** Each thing the page is described as: its type, and its name. */
  items: { type: string; name?: string }[];
  /** Each type left out, and what it is missing. */
  leftOut: { type: string; message: string }[];
  /** The JSON-LD itself, as the page is given it. */
  json: string;
}

/** What Nextly holds at the address, besides the comparison. */
export interface Held {
  /** The page's name, where a page Nextly holds has this address. */
  name?: string;
  /** Where its SEO is edited, where it is. */
  editHref?: string;
  stored?: StoredValues;
  structuredData?: HeldStructuredData;
}

/** What the check answers: the comparison, or why it was refused. */
export type ReceivedAnswer =
  | (Held & {
      kind: "checked";
      /** The address checked. */
      address: string;
      /** When, as an ISO date. */
      fetchedAt: string;
      /** What the site's robots.txt asks of AI crawlers. */
      aiCrawlers: AiCrawlerChoice;
      crawlers: CrawlerResult[];
      rows: Record<RowKey, Record<CrawlerKey, ReceivedCell>>;
      differences: ReceivedDifference[];
    })
  | (Held & {
      kind: "refused";
      address: string;
      reason: FetchStop;
      message: string;
      /** The site's own host, which Inspect fetches, where it has one. */
      site?: string;
    });

/** How far one fetch may go. */
export interface FetchLimits {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
}

/**
 * Ten seconds, five megabytes and five redirects: what every fetch is held
 * to, and what the screen says it is held to.
 */
export const FETCH_LIMITS: FetchLimits = {
  timeoutMs: 10_000,
  maxBytes: 5 * 1024 * 1024,
  maxRedirects: 5,
};
