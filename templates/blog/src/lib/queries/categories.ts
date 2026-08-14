/**
 * Category query helpers.
 *
 * Caching: reads are wrapped in `cachedFind` and tagged with
 * `nextlyTags("categories")` so a category write busts them. The
 * post-count helper also carries `nextlyTags("posts")` because its numbers
 * change when a post is published or removed from a category.
 */

// Pass nextlyConfig (loaded via the -config path alias) so
// getNextly() bootstraps with this project's collections list.
import { getNextly } from "nextly";
import { cachedFind, nextlyTags } from "nextly/runtime";
import nextlyConfig from "@nextly-config";

import { toCategory } from "./coerce";
import type { Category, TaxonomyWithCount } from "./types";

export async function getCategoryBySlug(
  slug: string
): Promise<Category | null> {
  try {
    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const result = await nextly.find({
          collection: "categories",
          where: { slug: { equals: slug } },
          limit: 1,
          depth: 0,
        });
        const found = result.items[0];
        return found ? toCategory(found) : null;
      },
      {
        tags: nextlyTags("categories"),
        keyParts: ["categories", "detail", slug],
      }
    );
  } catch (error) {
    // Rethrow, don't return null: a genuine miss returns null above (cached
    // with the categories tag, recoverable), but swallowing a transient error
    // into null would bake a tagless, timerless notFound() — a permanent 404.
    console.error(`Error fetching category by slug ${slug}:`, error);
    throw error;
  }
}

/**
 * All categories as full records. Used by the homepage CategoryStrip
 * and by the future /categories index page. If you need post counts
 * alongside each category, prefer `getAllCategoriesWithCounts` below.
 */
export async function getAllCategories(): Promise<Category[]> {
  try {
    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const result = await nextly.find({
          collection: "categories",
          limit: 1000,
          depth: 0,
        });
        return result.items.map(toCategory);
      },
      { tags: nextlyTags("categories"), keyParts: ["categories", "all"] }
    );
  } catch (error) {
    console.error("Error fetching all categories:", error);
    return [];
  }
}

export async function getAllCategorySlugs(): Promise<string[]> {
  try {
    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const result = await nextly.find({
          collection: "categories",
          limit: 1000,
          depth: 0,
        });
        return result.items.map(d => d.slug as string);
      },
      { tags: nextlyTags("categories"), keyParts: ["categories", "slugs"] }
    );
  } catch (error) {
    console.error("Error fetching all category slugs:", error);
    return [];
  }
}

/**
 * All categories paired with their published-post counts. Used on a
 * categories index page (or footer widget) to show "(N posts)" per
 * category.
 *
 * Runs one count query per category. Acceptable for a small-to-medium
 * blog; if you have hundreds of categories, consider a single SQL query
 * with GROUP BY and drop this helper.
 *
 * Carries both the categories and posts tags: a post publish/unpublish
 * changes these counts, so it must bust this cache too.
 */
export async function getAllCategoriesWithCounts(): Promise<
  TaxonomyWithCount<Category>[]
> {
  try {
    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const cats = await nextly.find({
          collection: "categories",
          limit: 1000,
          depth: 0,
        });
        return await Promise.all(
          cats.items.map(async cat => {
            const catId = String(cat.id);
            // No inner catch: a count failure must reject the whole read so the
            // outer fallback runs uncached, instead of caching a wrong zero
            // count until the next category/post write busts the tag.
            const posts = await nextly.find({
              collection: "posts",
              where: {
                and: [
                  { status: { equals: "published" } },
                  { categories: { contains: catId } },
                ],
              },
              limit: 0,
              depth: 0,
            });
            return {
              item: toCategory(cat),
              postCount: posts.meta.total,
            };
          })
        );
      },
      {
        tags: [...nextlyTags("categories"), ...nextlyTags("posts")],
        keyParts: ["categories", "with-counts"],
      }
    );
  } catch (error) {
    console.error("Error fetching categories with counts:", error);
    return [];
  }
}
