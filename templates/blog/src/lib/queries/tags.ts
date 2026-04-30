/**
 * Tag query helpers. Mirrors the categories helpers — tags use the
 * same collection shape and the same hasMany relationship storage.
 */

// Use project-local wrapper so getNextly() bootstraps with the
// nextly.config.ts collections list. See src/lib/nextly.ts.
import { getNextly } from "@/lib/nextly";

import type { Tag, TaxonomyWithCount } from "./types";

export async function getTagBySlug(slug: string): Promise<Tag | null> {
  const nextly = await getNextly();
  const result = await nextly.find({
    collection: "tags",
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
  });
  return result.docs[0] ? (result.docs[0] as Tag) : null;
}

export async function getAllTagSlugs(): Promise<string[]> {
  const nextly = await getNextly();
  const result = await nextly.find({
    collection: "tags",
    limit: 1000,
    depth: 0,
  });
  return result.docs.map(d => d.slug as string);
}

export async function getAllTagsWithCounts(): Promise<
  TaxonomyWithCount<Tag>[]
> {
  const nextly = await getNextly();
  const all = await nextly.find({
    collection: "tags",
    limit: 1000,
    depth: 0,
  });
  return Promise.all(
    all.docs.map(async tag => {
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
        postCount: posts.totalDocs,
      };
    })
  );
}
