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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Whether `collection` has the built-in draft/published lifecycle enabled
 * (`status: true`). A status-less collection has no `status` column, so a
 * blanket `status = published` predicate would either be silently dropped or —
 * if the collection defines its own field named `status` — wrongly filter live
 * rows; both routing reads gate the filter on this. Mirrors the sitemap plugin.
 */
export async function collectionHasStatusLifecycle(
  nextly: Nextly,
  collection: string
): Promise<boolean> {
  const result = await nextly.collectionsHandler.getCollection({
    collectionName: collection,
  });
  const data = isRecord(result) ? result.data : undefined;
  return isRecord(data) && data.status === true;
}

/** Options for {@link resolveContent}. */
export interface ResolveContentOptions {
  /**
   * A booted Nextly instance. Defaults to the runtime singleton (`getNextly()`),
   * which requires services to be registered — pass one explicitly from a
   * frontend read path that boots the config itself.
   */
  nextly?: Nextly;
  /** The field holding the URL slug (default `"slug"`). */
  slugField?: string;
  /** The field holding the publish status (default `"status"`). */
  statusField?: string;
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
   */
  revalidate?: number | false;
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
      // Only require `published` when the collection actually has that field: a
      // custom `statusField` is the caller asserting it exists, and the default
      // `status` field only exists when the built-in lifecycle is enabled.
      const filterByStatus =
        statusField !== "status" ||
        (await collectionHasStatusLifecycle(nextly, collection));
      const slugCondition = { [slugField]: { equals: slug } };
      const where = filterByStatus
        ? { and: [{ [statusField]: { equals: "published" } }, slugCondition] }
        : slugCondition;
      const result = await nextly.find({
        collection,
        where,
        limit: 1,
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
        collection,
        slugField,
        slug,
        locale ?? "",
        statusField,
        String(depth),
        options.richTextFormat ?? "json",
      ],
      revalidate: options.revalidate ?? false,
    }
  );
}
