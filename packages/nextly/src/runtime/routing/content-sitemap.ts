/**
 * `contentSitemapEntries` — the URLs a content route serves, as sitemap entries.
 *
 * Feeds {@link nextlySitemap}'s caller-supplied `entries`, which stays
 * caller-supplied so `nextly` need not depend on the SEO plugin. This is the
 * answer for content routes specifically; a site with other URL sources
 * concatenates them.
 *
 * **Beside the route rather than in a renderer package.** "Which URL does this
 * entry serve at" is a property of the ROUTE, not of what draws the page, so a
 * blocks page and any other content route must get the same answer. Putting it
 * next to `createContentRoute` is what stops the second renderer needing its own
 * copy of the rule — and a second copy is how a sitemap comes to advertise paths
 * the route does not serve.
 *
 * @module runtime/routing/content-sitemap
 */
import { getNextly } from "../../direct-api/nextly";
import { NextlyError } from "../../errors/nextly-error";

import { slugToStaticParam } from "./content-route";
import type { NextlyContentReader } from "./resolve-content";
import type { NextlySitemapEntry } from "./sitemap";

/**
 * The sitemap protocol's per-file ceiling: 50,000 URLs, and 50MB uncompressed.
 *
 * A file over it is rejected as a whole rather than truncated by the consumer,
 * so the count is enforced HERE, where the caller can be told which pages were
 * left out and what to do about it. Next's own answer for a larger site is
 * `generateSitemaps`, which splits by id.
 */
export const SITEMAP_MAX_URLS = 50_000;

/** Rows read per query while paginating; the read asks for one column. */
const PAGE_SIZE = 500;

/** Options for {@link contentSitemapEntries}. */
export interface ContentSitemapOptions {
  /**
   * Collections to enumerate, in the order the route resolves them.
   *
   * The same list the route was configured with. A sitemap built from a
   * different list advertises paths the route will answer with `notFound()`, or
   * omits paths it serves, and nothing reports either.
   */
  collections: string[];
  /**
   * Absolute origin, e.g. `https://example.com`. Required by the sitemap
   * protocol, which does not accept a relative URL.
   */
  baseUrl: string;
  /**
   * Where the route is mounted, e.g. `/blocks` for `app/blocks/[[...slug]]`.
   * Defaults to the site root.
   */
  basePath?: string;
  /** Field holding the slug (default `"slug"`), matching the route's. */
  slugField?: string;
  /**
   * Lifecycle scope (default `"published"`).
   *
   * A sitemap lists what a visitor can reach, so the default is the published
   * scope rather than the route's — a route serving drafts to a previewing
   * editor must not advertise them to a crawler.
   */
  status?: "published" | "draft" | "all";
  /** Locale to read in, matching the route's. */
  locale?: string;
  /** Field carrying the last-modified timestamp, e.g. `"updatedAt"`. */
  lastModifiedField?: string;
  /** `changeFrequency` applied to every entry, if the site wants one. */
  changeFrequency?: NextlySitemapEntry["changeFrequency"];
  /** `priority` applied to every entry, if the site wants one. */
  priority?: number;
  /**
   * Maximum URLs to emit. Defaults to {@link SITEMAP_MAX_URLS}.
   *
   * Lower it to carve a site into `generateSitemaps` shards; raising it past the
   * protocol ceiling produces a file consumers reject.
   */
  limit?: number;
  /** Reader to use, for a per-tenant instance. Defaults to the process one. */
  nextly?: NextlyContentReader;
}

/**
 * Enumerate the published paths of one or more collections as sitemap entries.
 *
 * Paths come from {@link slugToStaticParam}, the route's own answer to what a
 * stored slug renders at, so a sitemap cannot name a path the route does not
 * serve. Re-deriving that rule here is exactly how the two would come to
 * disagree, and the disagreement is silent in both directions.
 */
export async function contentSitemapEntries(
  options: ContentSitemapOptions
): Promise<NextlySitemapEntry[]> {
  const {
    collections,
    baseUrl,
    basePath = "",
    slugField = "slug",
    status = "published",
    locale,
    lastModifiedField,
    changeFrequency,
    priority,
    limit = SITEMAP_MAX_URLS,
    nextly,
  } = options;

  if (limit <= 0) return [];

  const reader = nextly ?? getNextly();
  const origin = trimTrailingSlash(baseUrl);
  const mount = normalizeBasePath(basePath);
  const entries: NextlySitemapEntry[] = [];
  // Two collections can hold the same slug, and the route resolves such a path
  // to the FIRST collection that answers. Emitting both would advertise one URL
  // twice, so the first wins here for the same reason it wins there.
  const seen = new Set<string>();

  for (const collection of collections) {
    let page = 1;
    for (;;) {
      let result;
      try {
        result = await reader.find({
          collection,
          status,
          ...(locale ? { locale } : {}),
          // One column, plus the timestamp when the caller asked for it. A
          // sitemap scan that inherited the route's depth would pull related
          // rows through their hooks and discard them.
          select: {
            [slugField]: true,
            ...(lastModifiedField ? { [lastModifiedField]: true } : {}),
          },
          // `id` is unique and present on every collection; a non-unique sort
          // lets rows shift between pages and duplicate or vanish across a
          // paginated scan.
          sort: "id",
          limit: PAGE_SIZE,
          page,
          // The sitemap is served to anonymous crawlers, so it is built as one.
          user: undefined,
        });
      } catch (error) {
        // An access-restricted collection has no PUBLIC paths to advertise.
        // Skipping it is correct; failing the build over it is not. Any
        // non-access error still surfaces.
        if (NextlyError.is(error) && error.statusCode === 403) break;
        throw error;
      }

      for (const item of result.items) {
        const param = slugToStaticParam(item[slugField]);
        if (!param) continue;
        const url = `${origin}${mount}${param.slug.length > 0 ? `/${param.slug.join("/")}` : ""}`;
        if (seen.has(url)) continue;
        seen.add(url);
        entries.push({
          url,
          ...lastModifiedOf(item, lastModifiedField),
          ...(changeFrequency ? { changeFrequency } : {}),
          ...(priority === undefined ? {} : { priority }),
        });
        if (entries.length >= limit) return truncated(entries, limit);
      }

      if (!result.meta.hasNext) break;
      page += 1;
    }
  }

  return entries;
}

/**
 * Report the cut rather than returning a quietly short list.
 *
 * A sitemap that stops at the ceiling looks exactly like a site that has that
 * many pages, so nothing downstream can tell the difference and the missing
 * pages are simply never crawled. The result shape is fixed by the sitemap
 * protocol and has nowhere to carry a third state, so the signal goes where a
 * developer will meet it: the build log, naming the remedy.
 */
function truncated(
  entries: NextlySitemapEntry[],
  limit: number
): NextlySitemapEntry[] {
  console.warn(
    `[nextly] sitemap reached its ${limit}-URL limit and stopped. ` +
      `Pages beyond it are absent and will not be crawled. ` +
      `Split the sitemap with Next's generateSitemaps and give each shard its own limit.`
  );
  return entries;
}

/** The entry's timestamp, when the caller named a field carrying one. */
function lastModifiedOf(
  item: Record<string, unknown>,
  field: string | undefined
): { lastModified?: string | Date } {
  if (!field) return {};
  const value = item[field];
  // A Date passes through; a string is what most drivers return. Anything else
  // is omitted rather than coerced — `lastModified` is optional, and a wrong
  // date is worse for a crawler than an absent one.
  if (value instanceof Date) return { lastModified: value };
  if (typeof value === "string" && value.length > 0) {
    return { lastModified: value };
  }
  return {};
}

/** `https://x.com/` and `https://x.com` must produce the same URLs. */
function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/** `blocks`, `/blocks` and `/blocks/` all mount at `/blocks`. */
function normalizeBasePath(value: string): string {
  const trimmed = trimTrailingSlash(value.trim());
  if (trimmed === "") return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
