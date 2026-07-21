/**
 * Tag query helpers. Mirrors the categories helpers — tags use the
 * same collection shape and the same hasMany relationship storage.
 */

// Pass nextlyConfig (loaded via the -config path alias) so
// getNextly() bootstraps with this project's collections list.
import { getNextly } from "nextly";
import nextlyConfig from "@nextly-config";

import type { Tag, TaxonomyWithCount } from "./types";

export async function getTagBySlug(slug: string): Promise<Tag | null> {
  try {
    const nextly = await getNextly({ config: nextlyConfig });
    const result = await nextly.find({
      collection: "tags",
      where: { slug: { equals: slug } },
      limit: 1,
      depth: 0,
    });
    return result.items[0] ? (result.items[0] as Tag) : null;
  } catch (error) {
    console.error(`Error fetching tag by slug ${slug}:`, error);
    return null;
  }
}

export async function getAllTagSlugs(): Promise<string[]> {
  try {
    const nextly = await getNextly({ config: nextlyConfig });
    const result = await nextly.find({
      collection: "tags",
      limit: 1000,
      depth: 0,
    });
    return result.items.map(d => d.slug as string);
  } catch (error) {
    console.error("Error fetching all tag slugs:", error);
    return [];
  }
}

export async function getAllTagsWithCounts(): Promise<
  TaxonomyWithCount<Tag>[]
> {
  try {
    const nextly = await getNextly({ config: nextlyConfig });
    const all = await nextly.find({
      collection: "tags",
      limit: 1000,
      depth: 0,
    });
    return await Promise.all(
      all.items.map(async tag => {
        const tagId = String(tag.id);
        try {
          const posts = await nextly.find({
            collection: "posts",
            where: {
              and: [
                { status: { equals: "published" } },
                { tags: { contains: tagId } },
              ],
            },
            limit: 0,
            depth: 0,
          });
          return {
            item: tag as Tag,
            postCount: posts.meta.total,
          };
        } catch {
          // If count fails, return tag with 0 posts
          return {
            item: tag as Tag,
            postCount: 0,
          };
        }
      })
    );
  } catch (error) {
    console.error("Error fetching tags with counts:", error);
    return [];
  }
}
