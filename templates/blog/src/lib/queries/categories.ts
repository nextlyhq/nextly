/**
 * Category query helpers.
 */

import { getNextly } from "@revnixhq/nextly";

import type { Category, TaxonomyWithCount } from "./types";

export async function getCategoryBySlug(
  slug: string
): Promise<Category | null> {
  const nextly = await getNextly();
  const result = await nextly.find({
    collection: "categories",
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
  });
  return result.docs[0] ? (result.docs[0] as Category) : null;
}

export async function getAllCategorySlugs(): Promise<string[]> {
  const nextly = await getNextly();
  const result = await nextly.find({
    collection: "categories",
    limit: 1000,
    depth: 0,
  });
  return result.docs.map(d => d.slug as string);
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
  const nextly = await getNextly();
  const cats = await nextly.find({
    collection: "categories",
    limit: 1000,
    depth: 0,
  });
  return Promise.all(
    cats.docs.map(async cat => {
      const posts = await nextly.find({
        collection: "posts",
        where: {
          and: [
            { status: { equals: "published" } },
            { categories: { contains: cat.id as string } },
          ],
        },
        limit: 0,
        depth: 0,
      });
      return {
        item: cat as Category,
        postCount: posts.totalDocs,
      };
    })
  );
}
