/**
 * `resolveContent` — resolve a URL slug to a single PUBLISHED content entry,
 * cached with F1 so the page and its metadata share one read and go stale in
 * lockstep on a content write.
 *
 * A genuine miss returns `null` (the caller renders `notFound()`), while a
 * transient read error is RETHROWN rather than swallowed to `null` — so a DB
 * blip becomes a retryable error instead of a permanently-cached 404 (the exact
 * lesson from the F1 blog-template review).
 *
 * @module runtime/routing/resolve-content
 */
import { getNextly } from "../../direct-api/nextly";
import type { Nextly } from "../../direct-api/nextly";
import { cachedFind } from "../cache/cached-find";
import { nextlyTags } from "../cache/nextly-tags";

/** A resolved content entry (loose by design — shape is the app's collection). */
export type ContentEntry = Record<string, unknown>;

/**
 * The booted-Nextly surface these helpers need: just a `find` reader. Typed
 * structurally (not as the Direct API class) so BOTH the internal singleton and
 * the public instance returned by `await getNextly(config)` satisfy it — the
 * public interface does not expose the Direct API's internal handlers.
 */
export type NextlyContentReader = Pick<Nextly, "find">;

/** Options for {@link resolveContent}. */
export interface ResolveContentOptions {
  /**
   * A booted Nextly instance. Defaults to the runtime singleton (`getNextly()`),
   * which requires services to be registered — pass one explicitly (e.g. the
   * value from `await getNextly(config)`) from a frontend read path that boots
   * the config itself.
   */
  nextly?: NextlyContentReader;
  /** The field holding the URL slug (default `"slug"`). */
  slugField?: string;
  /**
   * The field holding the publish status (default `"status"`), matched against
   * `"published"`. Pass `false` to skip status filtering entirely — required
   * for status-less collections (no built-in draft/published lifecycle), which
   * have no such column.
   */
  statusField?: string | false;
  /** Relation population depth for rendering (default `1`). */
  depth?: number;
  /** Read a specific locale (localized collections). */
  locale?: string;
  /** Rich-text output format for rich-text fields (default `"json"`). */
  richTextFormat?: "json" | "html" | "both";
  /**
   * Extra cache tags merged with the collection's own tag. Add related
   * collections' tags (e.g. `nextlyTags("authors")`) when a `depth > 0` read
   * populates relations, so a write to one of those busts this read too.
   */
  tags?: string[];
  /**
   * Time-based revalidation in seconds — a safety net on top of tag-based
   * busting. `false` (default) means the read only revalidates on a tag bust.
   * A non-positive value is treated as `false` (`unstable_cache` rejects `0`).
   */
  revalidate?: number | false;
  /**
   * A stable discriminator folded into the cache key. Supply a unique value when
   * distinct `nextly` readers (e.g. per-tenant or per-database) can resolve the
   * same collection + slug, so their cached reads never alias each other.
   */
  cacheScope?: string;
}

/**
 * Resolve a published entry by slug in `collection`, F1-cached and tagged so a
 * write to the collection busts it.
 *
 * @example
 * ```ts
 * const post = await resolveContent("posts", slug, { depth: 2 });
 * if (!post) notFound();
 * ```
 */
export async function resolveContent(
  collection: string,
  slug: string,
  options: ResolveContentOptions = {}
): Promise<ContentEntry | null> {
  const nextly = options.nextly ?? getNextly();
  const slugField = options.slugField ?? "slug";
  const statusField = options.statusField ?? "status";
  const depth = options.depth ?? 1;
  const locale = options.locale;

  return cachedFind(
    async () => {
      // Filter by `published` unless the caller opted out (`statusField: false`)
      // for a status-less collection that has no such column.
      const slugCondition = { [slugField]: { equals: slug } };
      const where =
        statusField === false
          ? slugCondition
          : {
              and: [{ [statusField]: { equals: "published" } }, slugCondition],
            };
      const result = await nextly.find({
        collection,
        where,
        limit: 1,
        // A slug field is ordinary text and need not be unique; sort by the
        // always-present unique `id` so duplicate-slug rows resolve to the same
        // entry deterministically instead of an arbitrary one.
        sort: "id",
        depth,
        ...(options.richTextFormat
          ? { richTextFormat: options.richTextFormat }
          : {}),
        // The content locale drives the localized read + fallback.
        ...(locale ? { locale } : {}),
      });
      return result.items[0] ?? null;
    },
    {
      // Tag by the collection so any write to it makes this read fresh, plus any
      // caller-supplied tags (related collections a populated read depends on).
      // The key varies by every dimension that changes the read result — slug,
      // locale, and the query shape (status field, depth, rich-text format) — so
      // two callers that differ in any of them never share a cache entry.
      tags: [...nextlyTags(collection), ...(options.tags ?? [])],
      keyParts: [
        "nextly",
        "resolve-content",
        // A caller-supplied scope so distinct readers (per-tenant/per-database)
        // resolving the same collection + slug never share a cache entry.
        options.cacheScope ?? "",
        collection,
        slugField,
        slug,
        locale ?? "",
        statusField === false ? "no-status" : statusField,
        String(depth),
        options.richTextFormat ?? "json",
      ],
      // `unstable_cache` rejects `revalidate: 0` (needs `false` or `> 0`), so a
      // non-positive value degrades to tag-only busting rather than failing.
      revalidate:
        typeof options.revalidate === "number" && options.revalidate > 0
          ? options.revalidate
          : false,
    }
  );
}
