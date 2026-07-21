/**
 * Category query helpers.
 */

// Pass nextlyConfig (loaded via the -config path alias) so
// getNextly() bootstraps with this project's collections list.
import { getNextly } from "nextly";
import nextlyConfig from "@nextly-config";

import type { Category, TaxonomyWithCount } from "./types";

export async function getCategoryBySlug(
  slug: string
): Promise<Category | null> {
  try {
    const nextly = await getNextly({ config: nextlyConfig });
    const result = await nextly.find({
      collection: "categories",
      where: { slug: { equals: slug } },
      limit: 1,
      depth: 0,
    });
    return result.items[0] ? (result.items[0] as Category) : null;
  } catch (error) {
    console.error(`Error fetching category by slug ${slug}:`, error);
    return null;
  }
}

/**
 * All categories as full records. Used by the homepage CategoryStrip
 * and by the future /categories index page. If you need post counts
 * alongside each category, prefer `getAllCategoriesWithCounts` below.
 */
export async function getAllCategories(): Promise<Category[]> {
  try {
    const nextly = await getNextly({ config: nextlyConfig });
    const result = await nextly.find({
      collection: "categories",
      limit: 1000,
      depth: 0,
    });
    return result.items.map(d => d as unknown as Category);
  } catch (error) {
    console.error("Error fetching all categories:", error);
    return [];
  }
}

export async function getAllCategorySlugs(): Promise<string[]> {
  try {
    const nextly = await getNextly({ config: nextlyConfig });
    const result = await nextly.find({
      collection: "categories",
      limit: 1000,
      depth: 0,
    });
    return result.items.map(d => d.slug as string);
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
 */
export async function getAllCategoriesWithCounts(): Promise<
  TaxonomyWithCount<Category>[]
> {
  try {
    const nextly = await getNextly({ config: nextlyConfig });
    const cats = await nextly.find({
      collection: "categories",
      limit: 1000,
      depth: 0,
    });
    return await Promise.all(
      cats.items.map(async cat => {
        const catId = String(cat.id);
        try {
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
            item: cat as Category,
            postCount: posts.meta.total,
          };
        } catch {
          // If count fails, return category with 0 posts
          return {
            item: cat as Category,
            postCount: 0,
          };
        }
      })
    );
  } catch (error) {
    console.error("Error fetching categories with counts:", error);
    return [];
  }
}
