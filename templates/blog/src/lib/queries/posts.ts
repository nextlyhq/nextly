/**
 * Post query helpers.
 *
 * All helpers return posts populated to depth=2 (author, categories, tags,
 * featuredImage) unless explicitly noted. Callers that need just the slug
 * list (e.g. generateStaticParams) use `getAllPostSlugs` which runs at
 * depth=0 for speed.
 *
 * Helpers that look up a single entity return `null` (not a thrown error)
 * when nothing matches; pages should call `notFound()` from `next/navigation`
 * to render the 404 page.
 *
 * Caching: every read is wrapped in `cachedFind`. Publishing, editing, or
 * deleting a post busts `nextly:posts` on write (the admin route registers the
 * Next cache adapter for you), so these pages regenerate on the next request
 * with no rebuild and no fixed timer. All reads are public (published content,
 * no per-caller filter), so a stable cache key shared by every visitor is
 * correct; the varying arguments (slug, page, limit, ...) go in `keyParts`.
 *
 * Depth>=1 reads embed related author / category / tag records, so an edit to
 * one of those must also refresh the post pages showing it. Those reads use
 * `POST_WITH_RELATIONS_TAGS`: category and tag writes bust their own collection
 * tags immediately, and because the `users` collection (authors) does not emit
 * cache tags yet, those reads also carry a time-based safety net
 * (`RELATION_REVALIDATE_SECONDS`) so an author profile edit becomes visible
 * within that window. Depth=0 reads select only post columns and stay tagged
 * with `nextly:posts` alone.
 */

// Pass nextlyConfig (loaded via the @nextly-config path alias) so
// getNextly() bootstraps with this project's collections list.
// Without this, the global singleton initializes empty and
// find('posts') throws "Schema not in registry".
import { getNextly } from "nextly";
import type { WhereFilter } from "nextly";
import { cachedFind, nextlyTags } from "nextly/runtime";
import nextlyConfig from "@nextly-config";

import type { Post } from "./types";
import { getCategoryBySlug } from "./categories";
import { getTagBySlug } from "./tags";

const PUBLISHED = { status: { equals: "published" } };

/**
 * Tags for a read that populates related records (depth>=1). Carries the post,
 * category, tag, user, and media collection tags so an edit to any embedded
 * relation busts these pages. Categories and tags emit their tags on write; the
 * `users` and `media` tags are inert today (those system collections do not
 * emit cache tags — see `RELATION_REVALIDATE_SECONDS`) but future-proof the
 * read for when they do.
 */
const POST_WITH_RELATIONS_TAGS = [
  ...nextlyTags("posts"),
  ...nextlyTags("categories"),
  ...nextlyTags("tags"),
  ...nextlyTags("users"),
  ...nextlyTags("media"),
];

/**
 * Time-based safety net (seconds) for reads that embed author (user) or media
 * fields. The `users` and `media` system collections do not emit revalidation
 * tags today, so this window is how an author's updated name / bio / avatar, or
 * an edited featured / OG image's alt text or crop, becomes visible inside
 * posts. Lower it for fresher relation data at a higher DB cost.
 */
const RELATION_REVALIDATE_SECONDS = 3600;

/**
 * Nextly's `find()` returns loosely-typed documents (Record<string, unknown>).
 * These coercion helpers give us one place to narrow to the domain types —
 * the only place where we accept "TypeScript is wrong here" intentionally.
 * If runtime validation becomes important later, add a parser (zod, valibot)
 * inside these helpers.
 */
function coercePost(doc: unknown): Post {
  return doc as Post;
}
function coercePosts(docs: unknown[]): Post[] {
  return docs as Post[];
}

/**
 * Latest published posts. Content is Lexical JSON, not HTML — do not
 * render `post.content` from list results. Use `getPostBySlug` for the
 * detail page, which serializes to HTML.
 */
export async function getLatestPosts(limit = 3): Promise<Post[]> {
  try {
    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const result = await nextly.find({
          collection: "posts",
          where: PUBLISHED,
          sort: "-publishedAt",
          limit,
          depth: 2,
        });
        return coercePosts(result.items);
      },
      {
        tags: POST_WITH_RELATIONS_TAGS,
        keyParts: ["posts", "latest", String(limit)],
        revalidate: RELATION_REVALIDATE_SECONDS,
      }
    );
  } catch (error) {
    console.error("Error fetching latest posts:", error);
    return [];
  }
}

/**
 * The post flagged `featured: true`. Returns null if no post is marked
 * featured — the caller decides the fallback (show "Latest post" instead,
 * hide the hero, etc). A silent "latest-post" fallback here would make
 * the `featured` flag appear meaningless to template users.
 */
export async function getFeaturedPost(): Promise<Post | null> {
  try {
    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const result = await nextly.find({
          collection: "posts",
          where: {
            and: [PUBLISHED, { featured: { equals: true } }],
          },
          sort: "-publishedAt",
          limit: 1,
          depth: 2,
        });
        return result.items[0] ? coercePost(result.items[0]) : null;
      },
      {
        tags: POST_WITH_RELATIONS_TAGS,
        keyParts: ["posts", "featured"],
        revalidate: RELATION_REVALIDATE_SECONDS,
      }
    );
  } catch (error) {
    console.error("Error fetching featured post:", error);
    return null;
  }
}

export interface PostListOptions {
  page?: number;
  limit?: number;
}

/**
 * Paginated post-list shape used by helpers below. Aligned with Nextly's
 * canonical `ListResult` envelope: the page slice lives on `items` and
 * pagination metadata on `meta`. Pages, feeds, and components consume
 * this shape directly so they don't need to know whether the data came
 * from the Direct API or a higher-level helper.
 */
export interface PostListResult {
  items: Post[];
  meta: {
    total: number;
    totalPages: number;
    page: number;
  };
}

/**
 * Paginated list of published posts, newest first.
 * Used by /blog, /archive, and the homepage "latest" section.
 */
export async function getPosts({
  page = 1,
  limit = 9,
}: PostListOptions = {}): Promise<PostListResult> {
  try {
    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const result = await nextly.find({
          collection: "posts",
          where: PUBLISHED,
          sort: "-publishedAt",
          page,
          limit,
          depth: 2,
        });
        return {
          items: coercePosts(result.items),
          meta: {
            total: result.meta.total,
            totalPages: result.meta.totalPages,
            page,
          },
        };
      },
      {
        tags: POST_WITH_RELATIONS_TAGS,
        keyParts: ["posts", "list", String(page), String(limit)],
        revalidate: RELATION_REVALIDATE_SECONDS,
      }
    );
  } catch (error) {
    console.error("Error fetching posts:", error);
    return { items: [], meta: { total: 0, totalPages: 0, page: 1 } };
  }
}

/**
 * Look up a post by slug. Uses `richTextFormat: 'html'` so the content
 * field returns ready-to-render HTML instead of the Lexical JSON tree.
 * Only returns published posts — a draft preview system would need a
 * separate helper with a token-based auth check.
 * Returns null when the slug doesn't match or the post is not published.
 *
 * Tagged with the collection tags (not an entry-id tag): the id isn't known
 * until the read resolves, and a slug rename busts `nextly:posts` anyway, so
 * the old slug's page regenerates and 404s once the post moves.
 */
export async function getPostBySlug(slug: string): Promise<Post | null> {
  try {
    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const result = await nextly.find({
          collection: "posts",
          where: {
            and: [PUBLISHED, { slug: { equals: slug } }],
          },
          limit: 1,
          depth: 2,
          richTextFormat: "html",
        });
        return result.items[0] ? coercePost(result.items[0]) : null;
      },
      {
        tags: POST_WITH_RELATIONS_TAGS,
        keyParts: ["posts", "detail", slug],
        revalidate: RELATION_REVALIDATE_SECONDS,
      }
    );
  } catch (error) {
    // Rethrow rather than return null: a genuine miss (no published post)
    // already returns null above and caches a tagged 404 that a later publish
    // busts, but swallowing a transient DB error into null would make the page
    // bake a notFound() that carries no tags and no timer — a permanent 404 for
    // a real post. Letting it throw yields an uncached, retryable error instead.
    console.error(`Error fetching post by slug ${slug}:`, error);
    throw error;
  }
}

/**
 * All published post slugs. Used by generateStaticParams for build-time
 * static generation; depth=0 because we only need the slug field.
 * Cap at 1000 — plenty for typical blogs; if you exceed this, paginate.
 */
export async function getAllPostSlugs(): Promise<string[]> {
  try {
    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const result = await nextly.find({
          collection: "posts",
          where: PUBLISHED,
          limit: 1000,
          depth: 0,
        });
        return result.items.map(d => d.slug as string);
      },
      { tags: nextlyTags("posts"), keyParts: ["posts", "slugs"] }
    );
  } catch (error) {
    console.error("Error fetching all post slugs:", error);
    return [];
  }
}

export interface ArchiveEntry {
  id: string;
  title: string;
  slug: string;
  publishedAt: string | null;
}

/**
 * Lightweight post list for the /archive page: just the fields needed
 * to render a "date → title" row. depth: 0 keeps this cheap even with
 * hundreds of posts. Cap at 1000 — plenty for typical blogs; if you
 * exceed this, paginate the archive.
 */
export async function getAllPublishedForArchive(): Promise<ArchiveEntry[]> {
  try {
    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const result = await nextly.find({
          collection: "posts",
          where: PUBLISHED,
          sort: "-publishedAt",
          limit: 1000,
          depth: 0,
        });
        return result.items.map(d => ({
          id: d.id as string,
          title: d.title as string,
          slug: d.slug as string,
          publishedAt: (d.publishedAt as string | null) ?? null,
        }));
      },
      { tags: nextlyTags("posts"), keyParts: ["posts", "archive"] }
    );
  } catch (error) {
    console.error("Error fetching archive posts:", error);
    return [];
  }
}

/**
 * Posts by a given author, paginated.
 */
export async function getPostsByAuthor(
  authorId: string,
  opts: PostListOptions = {}
): Promise<PostListResult> {
  const { page = 1, limit = 20 } = opts;
  try {
    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const result = await nextly.find({
          collection: "posts",
          where: {
            and: [PUBLISHED, { author: { equals: authorId } }],
          },
          sort: "-publishedAt",
          page,
          limit,
          depth: 2,
        });
        return {
          items: coercePosts(result.items),
          meta: {
            total: result.meta.total,
            totalPages: result.meta.totalPages,
            page,
          },
        };
      },
      {
        tags: POST_WITH_RELATIONS_TAGS,
        keyParts: ["posts", "by-author", authorId, String(page), String(limit)],
        revalidate: RELATION_REVALIDATE_SECONDS,
      }
    );
  } catch (error) {
    console.error(`Error fetching posts by author ${authorId}:`, error);
    return { items: [], meta: { total: 0, totalPages: 0, page: 1 } };
  }
}

/**
 * Posts in a category, paginated.
 *
 * `categories` is a hasMany relationship stored as a JSON-encoded array
 * in a TEXT column (e.g. `["uuid1","uuid2"]`). The `contains` operator
 * translates to `LIKE '%value%'` which correctly matches the category
 * ID within the serialized JSON string.
 *
 * The slug→id lookup (`getCategoryBySlug`, itself cached) resolves before
 * the cached posts read so the two caches never nest.
 */
export async function getPostsByCategory(
  categorySlug: string,
  opts: PostListOptions = {}
): Promise<PostListResult> {
  const { page = 1, limit = 9 } = opts;
  try {
    const category = await getCategoryBySlug(categorySlug);
    if (!category) {
      return { items: [], meta: { total: 0, totalPages: 0, page: 1 } };
    }

    const categoryId = String(category.id);

    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const result = await nextly.find({
          collection: "posts",
          where: {
            and: [PUBLISHED, { categories: { contains: categoryId } }],
          },
          sort: "-publishedAt",
          page,
          limit,
          depth: 2,
        });
        return {
          items: coercePosts(result.items),
          meta: {
            total: result.meta.total,
            totalPages: result.meta.totalPages,
            page,
          },
        };
      },
      {
        tags: POST_WITH_RELATIONS_TAGS,
        keyParts: [
          "posts",
          "by-category",
          categorySlug,
          String(page),
          String(limit),
        ],
        revalidate: RELATION_REVALIDATE_SECONDS,
      }
    );
  } catch (error) {
    console.error(`Error fetching posts for category ${categorySlug}:`, error);
    return { items: [], meta: { total: 0, totalPages: 0, page: 1 } };
  }
}

/**
 * Posts with a given tag, paginated. Same hasMany TEXT column pattern.
 */
export async function getPostsByTag(
  tagSlug: string,
  opts: PostListOptions = {}
): Promise<PostListResult> {
  const { page = 1, limit = 9 } = opts;
  try {
    const tag = await getTagBySlug(tagSlug);
    if (!tag) {
      return { items: [], meta: { total: 0, totalPages: 0, page: 1 } };
    }

    const tagId = String(tag.id);

    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const result = await nextly.find({
          collection: "posts",
          where: {
            and: [PUBLISHED, { tags: { contains: tagId } }],
          },
          sort: "-publishedAt",
          page,
          limit,
          depth: 2,
        });
        return {
          items: coercePosts(result.items),
          meta: {
            total: result.meta.total,
            totalPages: result.meta.totalPages,
            page,
          },
        };
      },
      {
        tags: POST_WITH_RELATIONS_TAGS,
        keyParts: ["posts", "by-tag", tagSlug, String(page), String(limit)],
        revalidate: RELATION_REVALIDATE_SECONDS,
      }
    );
  } catch (error) {
    console.error(`Error fetching posts for tag ${tagSlug}:`, error);
    return { items: [], meta: { total: 0, totalPages: 0, page: 1 } };
  }
}

/**
 * Find the chronologically adjacent published posts for prev/next
 * navigation on a post detail page.
 *
 * "Previous" = the post published just before `currentPublishedAt`.
 * "Next" = the post published just after it. Either may be null at
 * the edges. Uses depth=0 because the caller only needs title + slug.
 */
export async function getAdjacentPosts(
  currentSlug: string,
  currentPublishedAt: string | null | undefined
): Promise<{
  previous: { title: string; slug: string } | null;
  next: { title: string; slug: string } | null;
}> {
  try {
    if (!currentPublishedAt) return { previous: null, next: null };

    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });

        const [prev, next] = await Promise.all([
          nextly.find({
            collection: "posts",
            where: {
              and: [
                PUBLISHED,
                { publishedAt: { less_than: currentPublishedAt } },
                { slug: { not_equals: currentSlug } },
              ],
            },
            sort: "-publishedAt",
            limit: 1,
            depth: 0,
          }),
          nextly.find({
            collection: "posts",
            where: {
              and: [
                PUBLISHED,
                { publishedAt: { greater_than: currentPublishedAt } },
                { slug: { not_equals: currentSlug } },
              ],
            },
            sort: "publishedAt",
            limit: 1,
            depth: 0,
          }),
        ]);

        const pick = (doc?: Record<string, unknown>) =>
          doc ? { title: doc.title as string, slug: doc.slug as string } : null;

        return {
          previous: pick(prev.items[0]),
          next: pick(next.items[0]),
        };
      },
      {
        tags: nextlyTags("posts"),
        keyParts: [
          "posts",
          "adjacent",
          currentSlug,
          String(currentPublishedAt),
        ],
      }
    );
  } catch (err) {
    console.error("[blog] getAdjacentPosts error:", err);
    return { previous: null, next: null };
  }
}

export interface RelatedPostsOptions {
  tagSlugs?: string[];
  categorySlugs?: string[];
  authorId?: string;
  limit?: number;
}

/**
 * Related posts for a post detail page.
 *
 * Layered match: shared tag → shared category → same author. Stops at
 * the first layer that returns results. If none match, returns [] so
 * the caller can hide the "Related Posts" section rather than show
 * unrelated newest posts (which would be misleading labelling).
 *
 * Each layer's posts read is cached under its own key; the slug→id
 * lookups resolve before the cached read so the caches never nest.
 */
export async function getRelatedPosts(
  currentSlug: string,
  opts: RelatedPostsOptions = {}
): Promise<Post[]> {
  try {
    const { tagSlugs = [], categorySlugs = [], authorId, limit = 2 } = opts;

    const excludeCurrent = { slug: { not_equals: currentSlug } };

    // Typed as WhereFilter rather than a bare record so a malformed operator
    // is rejected here instead of inside the `and` array the query builds.
    const tryQuery = (keySuffix: string, where: WhereFilter) =>
      cachedFind(
        async () => {
          const nextly = await getNextly({ config: nextlyConfig });
          const result = await nextly.find({
            collection: "posts",
            where: {
              and: [PUBLISHED, excludeCurrent, where],
            },
            sort: "-publishedAt",
            limit,
            depth: 2,
          });
          return coercePosts(result.items);
        },
        {
          tags: POST_WITH_RELATIONS_TAGS,
          keyParts: ["posts", "related", currentSlug, keySuffix, String(limit)],
          revalidate: RELATION_REVALIDATE_SECONDS,
        }
      );

    // Resolve slugs to IDs then use `contains` on the JSON-encoded TEXT column
    if (tagSlugs.length > 0) {
      const tag = await getTagBySlug(tagSlugs[0]);
      if (tag) {
        const docs = await tryQuery(`tag:${tag.id}`, {
          tags: { contains: String(tag.id) },
        });
        if (docs.length > 0) return docs;
      }
    }
    if (categorySlugs.length > 0) {
      const cat = await getCategoryBySlug(categorySlugs[0]);
      if (cat) {
        const docs = await tryQuery(`category:${cat.id}`, {
          categories: { contains: String(cat.id) },
        });
        if (docs.length > 0) return docs;
      }
    }
    if (authorId) {
      const docs = await tryQuery(`author:${authorId}`, {
        author: { equals: authorId },
      });
      if (docs.length > 0) return docs;
    }

    return [];
  } catch (err) {
    console.error("[blog] getRelatedPosts error:", err);
    return [];
  }
}
