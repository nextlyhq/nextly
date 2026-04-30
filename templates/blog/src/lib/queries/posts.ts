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
 */

// Pass nextlyConfig (loaded via the @nextly-config path alias) so
// getNextly() bootstraps with this project's collections list.
// Without this, the global singleton initializes empty and
// find('posts') throws "Schema not in registry".
import { getNextly } from "@revnixhq/nextly";
import nextlyConfig from "@nextly-config";

import type { Post } from "./types";

const PUBLISHED = { status: { equals: "published" } };

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
  const nextly = await getNextly({ config: nextlyConfig });
  const result = await nextly.find({
    collection: "posts",
    where: PUBLISHED,
    sort: "-publishedAt",
    limit,
    depth: 2,
  });
  return coercePosts(result.docs);
}

/**
 * The post flagged `featured: true`. Returns null if no post is marked
 * featured — the caller decides the fallback (show "Latest post" instead,
 * hide the hero, etc). A silent "latest-post" fallback here would make
 * the `featured` flag appear meaningless to template users.
 */
export async function getFeaturedPost(): Promise<Post | null> {
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
  return result.docs[0] ? coercePost(result.docs[0]) : null;
}

export interface PostListOptions {
  page?: number;
  limit?: number;
}

export interface PostListResult {
  docs: Post[];
  totalDocs: number;
  totalPages: number;
  page: number;
}

/**
 * Paginated list of published posts, newest first.
 * Used by /blog, /archive, and the homepage "latest" section.
 */
export async function getPosts({
  page = 1,
  limit = 9,
}: PostListOptions = {}): Promise<PostListResult> {
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
    docs: coercePosts(result.docs),
    totalDocs: result.totalDocs,
    totalPages: result.totalPages,
    page,
  };
}

/**
 * Look up a post by slug. Uses `richTextFormat: 'html'` so the content
 * field returns ready-to-render HTML instead of the Lexical JSON tree.
 * Only returns published posts — a draft preview system would need a
 * separate helper with a token-based auth check.
 * Returns null when the slug doesn't match or the post is not published.
 */
export async function getPostBySlug(slug: string): Promise<Post | null> {
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
  return result.docs[0] ? coercePost(result.docs[0]) : null;
}

/**
 * All published post slugs. Used by generateStaticParams for build-time
 * static generation; depth=0 because we only need the slug field.
 * Cap at 1000 — plenty for typical blogs; if you exceed this, paginate.
 */
export async function getAllPostSlugs(): Promise<string[]> {
  const nextly = await getNextly({ config: nextlyConfig });
  const result = await nextly.find({
    collection: "posts",
    where: PUBLISHED,
    limit: 1000,
    depth: 0,
  });
  return result.docs.map(d => d.slug as string);
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
  const nextly = await getNextly({ config: nextlyConfig });
  const result = await nextly.find({
    collection: "posts",
    where: PUBLISHED,
    sort: "-publishedAt",
    limit: 1000,
    depth: 0,
  });
  return result.docs.map(d => ({
    id: d.id as string,
    title: d.title as string,
    slug: d.slug as string,
    publishedAt: (d.publishedAt as string | null) ?? null,
  }));
}

/**
 * Posts by a given author, paginated.
 */
export async function getPostsByAuthor(
  authorId: string,
  opts: PostListOptions = {}
): Promise<PostListResult> {
  const { page = 1, limit = 20 } = opts;
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
    docs: coercePosts(result.docs),
    totalDocs: result.totalDocs,
    totalPages: result.totalPages,
    page,
  };
}

/**
 * Posts in a category, paginated.
 *
 * `categories` is a hasMany relationship; SQLite stores hasMany as a
 * JSON-encoded array in a text column, so we use the `contains` operator
 * (text search) rather than `in` (native array lookup). This works
 * uniformly across all Nextly-supported databases.
 */
export async function getPostsByCategory(
  categoryId: string,
  opts: PostListOptions = {}
): Promise<PostListResult> {
  const { page = 1, limit = 9 } = opts;
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
    docs: coercePosts(result.docs),
    totalDocs: result.totalDocs,
    totalPages: result.totalPages,
    page,
  };
}

/**
 * Posts with a given tag, paginated. Same hasMany pattern as categories.
 */
export async function getPostsByTag(
  tagId: string,
  opts: PostListOptions = {}
): Promise<PostListResult> {
  const { page = 1, limit = 9 } = opts;
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
    docs: coercePosts(result.docs),
    totalDocs: result.totalDocs,
    totalPages: result.totalPages,
    page,
  };
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
  if (!currentPublishedAt) return { previous: null, next: null };
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
    previous: pick(prev.docs[0]),
    next: pick(next.docs[0]),
  };
}

export interface RelatedPostsOptions {
  tagIds?: string[];
  categoryIds?: string[];
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
 */
export async function getRelatedPosts(
  currentSlug: string,
  opts: RelatedPostsOptions = {}
): Promise<Post[]> {
  const { tagIds = [], categoryIds = [], authorId, limit = 2 } = opts;
  const nextly = await getNextly({ config: nextlyConfig });

  const excludeCurrent = { slug: { not_equals: currentSlug } };

  const tryQuery = async (extra: Record<string, unknown>) => {
    const result = await nextly.find({
      collection: "posts",
      where: {
        and: [PUBLISHED, excludeCurrent, extra],
      },
      sort: "-publishedAt",
      limit,
      depth: 2,
    });
    return coercePosts(result.docs);
  };

  if (tagIds.length > 0) {
    const docs = await tryQuery({ tags: { contains: tagIds[0] } });
    if (docs.length > 0) return docs;
  }
  if (categoryIds.length > 0) {
    const docs = await tryQuery({ categories: { contains: categoryIds[0] } });
    if (docs.length > 0) return docs;
  }
  if (authorId) {
    const docs = await tryQuery({ author: { equals: authorId } });
    if (docs.length > 0) return docs;
  }

  return [];
}
