/**
 * What the "What search engines received" screen and its routes agree on:
 * where they are, the crawlers a page is fetched as, and the shape of what
 * the check answers. It imports only another contract, so the admin bundle
 * reads it without the server's code.
 *
 * @module received/contract
 */
import { INSPECT_PAGE_HREF } from "../overview/contract";

/** Where a page is checked, under the plugin's routes. */
export const RECEIVED_ROUTE_PATH = "/received";

/** Where the screen reads the pages it offers and the addresses allowed. */
export const RECEIVED_PAGES_ROUTE_PATH = "/received/pages";

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

/** The crawlers a page is fetched as, in the order they are shown. */
export const CRAWLERS = [
  {
    key: "googlebot",
    name: "Googlebot",
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/131.0.0.0 Safari/537.36",
  },
  {
    key: "linkedin",
    name: "LinkedIn",
    userAgent:
      "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
  },
  { key: "x", name: "X", userAgent: "Twitterbot/1.0" },
  {
    key: "slack",
    name: "Slack",
    userAgent: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
  },
] as const;

/** One of the crawlers, by key. */
export type CrawlerKey = (typeof CRAWLERS)[number]["key"];

/** The rows the screen compares, in the order they are shown. */
export const RECEIVED_ROWS = [
  { key: "title", label: "Title" },
  { key: "description", label: "Description" },
  { key: "image", label: "Share image" },
  { key: "canonical", label: "Official address" },
  { key: "robots", label: "Search listing" },
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
  /** The number of the difference explaining what it was answered. */
  difference?: number;
}

/** A difference, said in plain words, with the action that helps, if any. */
export interface ReceivedDifference {
  number: number;
  title: string;
  text: string;
  action?: { label: string; href: string };
}

/** What Nextly holds for the page, as the screen shows it. */
export interface StoredValues {
  title?: string;
  description?: string;
  image?: { url: string; width?: number; height?: number };
  canonical?: string;
  /** Whether the page is listed in search. */
  listed: boolean;
}

/** What the check answers: the comparison, or why it was refused. */
export type ReceivedAnswer =
  | {
      kind: "checked";
      /** The address checked. */
      address: string;
      /** When, as an ISO date. */
      fetchedAt: string;
      /** What Nextly holds, where a published page has this address. */
      stored?: StoredValues;
      crawlers: CrawlerResult[];
      rows: Record<RowKey, Record<CrawlerKey, ReceivedCell>>;
      differences: ReceivedDifference[];
    }
  | { kind: "refused"; address: string; message: string };

/** What the screen reads before it checks a page. */
export interface ReceivedPagesBody {
  /** The site's production addresses, the only ones that may be checked. */
  origins: string[];
  /** The site's listed pages, by full address. */
  pages: string[];
}
