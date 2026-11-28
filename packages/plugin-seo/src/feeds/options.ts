/**
 * The site's RSS feeds as its options name them: each a name, an address,
 * the content it is made from and how many items it holds, checked when the
 * site starts, so a mistyped address or source fails at boot rather than as
 * a feed that never answers.
 *
 * @module feeds/options
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { z } from "zod";

/** One item a code source gives a feed: a page the site builds in code, such as a release note. */
export interface FeedItem {
  /**
   * What tells this item apart from every other the site gives, for good,
   * such as `"release:1.4.0"`: its guid is made from it, and feed readers
   * know an item they have shown by it, so it never changes.
   */
  id: string;
  title: string;
  /** Its page: from the site's root (`/changelog#1.4.0`), or whole. */
  url: string;
  /** When it was published: a `Date`, or ISO 8601 text. */
  published: string | Date;
  /** When it last changed, where it did since. */
  updated?: string | Date;
  /** A summary, as plain text. */
  description?: string;
  /** Who wrote it, by name. */
  author?: string;
  /** The categories or tags it is filed under, by name. */
  categories?: readonly string[];
}

/** What a code source is told: the site's origin, which every address is made whole against. */
export interface FeedSourceAbout {
  origin: string;
}

/** A source of items that are not entries: a function giving them, newest first or in any order. */
export type FeedSource = (
  about: FeedSourceAbout
) => readonly FeedItem[] | Promise<readonly FeedItem[]>;

/** One feed, as the site's options name it. */
export interface FeedOption {
  /**
   * Where it is served: `/feed.xml`, or `feed.xml` in one folder of the
   * site, such as `/blog/feed.xml`. `withNextly` sends those addresses to the
   * plugin where the site serves nothing of its own there.
   */
  path: string;
  /** The feed's name, as a reader lists it. The site's name by default. */
  title?: string;
  /** What it holds. The site's description by default. */
  description?: string;
  /**
   * The page that lists what the feed holds, from the site's root: the
   * feed's folder by default, `/blog` for `/blog/feed.xml`.
   */
  link?: string;
  /**
   * What it is made from: collection slugs, whose published pages the
   * sitemap lists, and functions giving items built in code.
   */
  sources: readonly (string | FeedSource)[];
  /** How many of the newest items it holds: 10 to 50, 20 by default. */
  limit?: number;
  /**
   * Whether every page's head links it. By default only `/feed.xml` is,
   * and any other feed is linked from its own listing page and the pages
   * it is made from.
   */
  everyPage?: boolean;
}

/** A feed as the plugin serves it: its options checked and its defaults filled. */
export interface CheckedFeed {
  /** Its name in the options. */
  name: string;
  path: string;
  title?: string;
  description?: string;
  link: string;
  /** The collections it is made from. */
  collections: readonly string[];
  /** The code sources it is made from. */
  code: readonly FeedSource[];
  limit: number;
  everyPage: boolean;
}

/** How many items a feed holds where its options say nothing. */
const DEFAULT_FEED_ITEMS = 20;

/** The fewest and most items a feed may hold. */
const FEED_ITEMS = { least: 10, most: 50 } as const;

/**
 * A feed's address: `feed.xml` at the root or in one folder, the two shapes
 * `withNextly` rewrites to the plugin (its `FEED_FILE_SOURCES`). A folder is
 * one segment of letters, digits, `-`, `_` or `.`, not starting with a dot.
 */
const FEED_PATH = /^\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)?feed\.xml$/;

/**
 * An address from the site's root with nothing past its path. Not `//…`,
 * which a URL reads as another host (`//other.example/blog`), or none, and
 * no backslash, which a URL reads as a slash (`/\other.example`).
 */
const SITE_PATH = /^\/(?!\/)[^?#\s\\]*$/;

/** A collection's slug, as Nextly spells one. */
const COLLECTION_SLUG = /^[a-z0-9][a-z0-9_-]*$/;

const feedSchema = z.object({
  path: z
    .string()
    .regex(
      FEED_PATH,
      'must be "/feed.xml" or "feed.xml" in one folder, such as "/blog/feed.xml"'
    ),
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  link: z
    .string()
    .regex(SITE_PATH, 'must be a path from the site\'s root, such as "/blog"')
    .optional(),
  sources: z
    .array(
      z.union([
        z
          .string()
          .regex(COLLECTION_SLUG, "must be a collection's slug, such as posts"),
        z.custom<FeedSource>(value => typeof value === "function", {
          message: "must be a collection's slug or a function giving items",
        }),
      ])
    )
    .min(1, "must name at least one source"),
  limit: z.number().int().min(FEED_ITEMS.least).max(FEED_ITEMS.most).optional(),
  everyPage: z.boolean().optional(),
});

/** The folder a feed's address is in: `/blog` for `/blog/feed.xml`, `/` for `/feed.xml`. */
function folderOf(path: string): string {
  const folder = path.slice(0, path.lastIndexOf("/"));
  return folder === "" ? "/" : folder;
}

/** Refuse the options, naming the feed and what is wrong with it. */
function refuse(message: string): never {
  throw NextlyError.invalidInput({ message: `seoPlugin feeds: ${message}` });
}

/** The feed's options, parsed; refused, naming the feed and the option that is wrong, where they are not. */
function parsedFeed(
  name: string,
  option: FeedOption
): z.infer<typeof feedSchema> {
  const parsed = feedSchema.safeParse(option);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const at = issue?.path.join(".") ?? "";
  refuse(`"${name}"${at === "" ? "" : `.${at}`} ${issue?.message ?? ""}`);
}

/** One feed's parsed options with its defaults filled. */
function filledFeed(
  name: string,
  feed: z.infer<typeof feedSchema>
): CheckedFeed {
  const collections: string[] = [];
  const code: FeedSource[] = [];
  for (const source of feed.sources) {
    if (typeof source === "string") collections.push(source);
    else code.push(source);
  }
  return {
    name,
    path: feed.path,
    ...(feed.title === undefined ? {} : { title: feed.title }),
    ...(feed.description === undefined
      ? {}
      : { description: feed.description }),
    link: feed.link ?? folderOf(feed.path),
    collections,
    code,
    limit: feed.limit ?? DEFAULT_FEED_ITEMS,
    everyPage: feed.everyPage ?? feed.path === "/feed.xml",
  };
}

/**
 * The feeds the options name, checked, with their defaults filled; none
 * where they name none. Two feeds at one address are refused.
 */
export function checkedFeeds(
  feeds: Readonly<Record<string, FeedOption>> | undefined
): CheckedFeed[] {
  if (feeds === undefined) return [];
  const checked: CheckedFeed[] = [];
  const paths = new Map<string, string>();
  for (const [name, option] of Object.entries(feeds)) {
    const feed = parsedFeed(name, option);
    const other = paths.get(feed.path);
    if (other !== undefined) {
      refuse(`"${name}" and "${other}" are both served at ${feed.path}`);
    }
    paths.set(feed.path, name);
    checked.push(filledFeed(name, feed));
  }
  return checked;
}
