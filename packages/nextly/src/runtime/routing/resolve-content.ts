/**
 * `resolveContent` — resolve a URL slug to a single content entry, publish-state
 * and access enforced, cached with F1 so the page and its metadata share one
 * read and go stale in lockstep on a content write.
 *
 * A genuine miss (or an access-denied entry) returns `null` (the caller renders
 * `notFound()`), while a transient read error is RETHROWN rather than swallowed
 * to `null` — so a DB blip becomes a retryable error instead of a
 * permanently-cached 404 (the exact lesson from the F1 blog-template review).
 *
 * @module runtime/routing/resolve-content
 */
import { getNextly } from "../../direct-api/nextly";
import type { Nextly } from "../../direct-api/nextly";
import type { UserContext } from "../../direct-api/types/shared";
import { NextlyError } from "../../errors/nextly-error";
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
   * Draft/Published lifecycle scope (default `"published"`). This is
   * lifecycle-aware AND locale-aware: for a localized collection it also
   * constrains the per-locale companion `_status`, so a draft translation under
   * a published main row is not returned. On a status-less collection (no
   * built-in lifecycle) it is a no-op — every row is live.
   */
  status?: "published" | "draft" | "all";
  /** Relation population depth for rendering (default `1`). */
  depth?: number;
  /** Read a specific locale (localized collections). */
  locale?: string;
  /** Rich-text output format for rich-text fields (default the reader's). */
  richTextFormat?: "json" | "html" | "both";
  /**
   * Extra cache tags merged with the collection's own tag. Add related
   * collections' tags (e.g. `nextlyTags("authors")`) when a `depth > 0` read
   * populates relations, so a write to one of those busts this read too.
   */
  tags?: string[];
  /**
   * Time-based revalidation in seconds for a CACHED (trusted) read — a safety
   * net on top of tag-based busting. `false` (default) means tag-only; a
   * non-positive value is treated as `false`. Ignored for enforced or
   * user-scoped reads, which are never cached.
   */
  revalidate?: number | false;
  /**
   * A stable discriminator folded into the cache key. Supply a unique value when
   * distinct `nextly` readers (e.g. per-tenant or per-database) can resolve the
   * same collection + slug, so their cached reads never alias each other.
   */
  cacheScope?: string;
  /**
   * Whether to bypass the collection's read-access rules. Defaults to `false`,
   * so a content route enforces STORED access policies: a rule-less (public)
   * collection still renders, but one with a stored member-only/role-based read
   * rule is hidden from an unauthenticated request (resolves to `null` →
   * `notFound()`). Pass `true` for a fully trusted read. NOTE on anonymous
   * scope: an anonymous read enforces stored rules that DENY outright
   * (public/authenticated/role-based). A row-level CONSTRAINT rule (owner-only,
   * or a custom rule returning a query predicate) and inline
   * `defineCollection({ access })` code rules require a `user` context to
   * evaluate, so they are not applied for an anonymous read — gate such content
   * behind an authenticated read (pass a `user`) rather than relying on the
   * anonymous default. CACHING: only a trusted (`overrideAccess: true`) read
   * with no `user` is F1-cached — an enforced read is never cached (its access
   * decision can't be invalidated on a policy change). A public site that wants
   * cached pages should read its public content with `overrideAccess: true`.
   */
  overrideAccess?: boolean;
  /** User identity to evaluate access rules against (with `overrideAccess: false`). */
  user?: UserContext;
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
  const status = options.status ?? "published";
  const depth = options.depth ?? 1;
  const locale = options.locale;
  const overrideAccess = options.overrideAccess ?? false;
  const user = options.user;

  const read = async (): Promise<ContentEntry | null> => {
    try {
      const result = await nextly.find({
        collection,
        where: { [slugField]: { equals: slug } },
        // Lifecycle-aware publish scope — drives the query service's status
        // filter, so it also constrains a localized collection's companion
        // `_status` (a draft translation never leaks). A no-op on status-less
        // collections. The `where` clause no longer carries a status predicate.
        status,
        limit: 1,
        // A slug field is ordinary text and need not be unique; sort by the
        // always-present unique `id` so duplicate-slug rows resolve to the same
        // entry deterministically instead of an arbitrary one.
        sort: "id",
        depth,
        // Enforce the collection's read policy unless the caller opts out.
        overrideAccess,
        // Pass the user explicitly (even `undefined`) so an anonymous read
        // CLEARS any default user configured on the reader instead of merging
        // over it — otherwise a reader booted with a default identity would make
        // this "anonymous" read run as that member.
        user,
        ...(options.richTextFormat
          ? { richTextFormat: options.richTextFormat }
          : {}),
        // The content locale drives the localized read + fallback.
        ...(locale ? { locale } : {}),
      });
      return result.items[0] ?? null;
    } catch (error) {
      // An access denial (403) means the read policy hides this entry from the
      // caller — treat it as absent (→ notFound), never as a transient error.
      // Any other error still rethrows (retryable, not a permanently-cached 404).
      // `NextlyError.is` matches across bundled package copies where a plain
      // `instanceof` would miss a differently-realmed error class.
      if (NextlyError.is(error) && error.statusCode === 403) {
        return null;
      }
      throw error;
    }
  };

  // ONLY a trusted, userless read is cached. An enforced read's result depends
  // on an access decision that a content-tag bust can't invalidate — a stored
  // read-policy change (public → restricted) doesn't write an entry, so a cached
  // enforced result would keep serving to unauthorized visitors. And any read
  // carrying a user can produce user-dependent output via `afterRead` hooks.
  // So caching requires `overrideAccess: true` AND no user; every enforced or
  // user-scoped read runs fresh per request. A public site that wants cached
  // pages reads its public content trusted (`overrideAccess: true`).
  const cacheable = overrideAccess && !user;
  if (!cacheable) {
    return read();
  }

  return cachedFind(read, {
    // Tag by the collection so any write to it makes this read fresh, plus any
    // caller-supplied tags (related collections a populated read depends on).
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
      // The key varies by every dimension that changes the read result.
      status,
      String(depth),
      // When omitted, the read inherits the reader's default format (which may
      // not be "json"), so key it as "inherit" — never as a concrete format — so
      // an explicit-format call can't reuse an inherited-shape cache entry.
      options.richTextFormat ?? "inherit",
    ],
    // Trusted reads don't depend on an access decision, so tag-only busting is
    // safe; an explicit positive `revalidate` adds a time-based safety net, and
    // a non-positive value degrades to tag-only (`unstable_cache` rejects `0`).
    revalidate:
      typeof options.revalidate === "number" && options.revalidate > 0
        ? options.revalidate
        : false,
  });
}
