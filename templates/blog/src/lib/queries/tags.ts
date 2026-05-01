/**
 * Tag query helpers. Mirrors the categories helpers — tags use the
 * same collection shape and the same hasMany relationship storage.
 */

// Pass nextlyConfig (loaded via the -config path alias) so
// getNextly() bootstraps with this project's collections list.
import { getNextly } from "@revnixhq/nextly";
import nextlyConfig from "@nextly-config";

import type { Tag, TaxonomyWithCount } from "./types";

export async function getTagBySlug(slug: string): Promise<Tag | null> {
  const nextly = await getNextly({ config: nextlyConfig });
  const result = await nextly.find({
    collection: "tags",
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
  });
  // Phase 4 (Task 14): canonical envelope (`items`) replaces legacy `docs`.
  return result.items[0] ? (result.items[0] as Tag) : null;
}

export async function getAllTagSlugs(): Promise<string[]> {
  const nextly = await getNextly({ config: nextlyConfig });
  const result = await nextly.find({
    collection: "tags",
    limit: 1000,
    depth: 0,
  });
  // Phase 4 (Task 14): canonical envelope (`items`) replaces legacy `docs`.
  return result.items.map(d => d.slug as string);
}

export async function getAllTagsWithCounts(): Promise<
  TaxonomyWithCount<Tag>[]
> {
  const nextly = await getNextly({ config: nextlyConfig });
  const all = await nextly.find({
    collection: "tags",
    limit: 1000,
    depth: 0,
  });
  // Phase 4 (Task 14): canonical envelope; iterate `items` (was `docs`)
  // and read total count from `meta.total` (was `totalDocs`).
  return Promise.all(
    all.items.map(async tag => {
      const posts = await nextly.find({
        collection: "posts",
        where: {
          and: [
            { status: { equals: "published" } },
            { tags: { contains: tag.id as string } },
          ],
        },
        limit: 0,
        depth: 0,
      });
      return {
        item: tag as Tag,
        postCount: posts.meta.total,
      };
    })
  );
}
