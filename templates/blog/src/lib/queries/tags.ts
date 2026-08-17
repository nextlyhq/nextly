/**
 * Tag query helpers. Mirrors the categories helpers — tags use the
 * same collection shape and the same hasMany relationship storage.
 *
 * Caching: reads are wrapped in `cachedFind` and tagged with
 * `nextlyTags("tags")` so a tag write busts them. The post-count helper
 * also carries `nextlyTags("posts")` because its numbers change when a
 * post is published or removed from a tag.
 */

// Pass nextlyConfig (loaded via the -config path alias) so
// getNextly() bootstraps with this project's collections list.
import { getNextly } from "nextly";
import { cachedFind, nextlyTags } from "nextly/runtime";
import nextlyConfig from "@nextly-config";

import { toTag } from "./coerce";
import type { Tag, TaxonomyWithCount } from "./types";

export async function getTagBySlug(slug: string): Promise<Tag | null> {
  try {
    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const result = await nextly.find({
          collection: "tags",
          where: { slug: { equals: slug } },
          limit: 1,
          depth: 0,
        });
        const found = result.items[0];
        return found ? toTag(found) : null;
      },
      { tags: nextlyTags("tags"), keyParts: ["tags", "detail", slug] }
    );
  } catch (error) {
    // Rethrow, don't return null: a genuine miss returns null above (cached
    // with the tags tag, recoverable), but swallowing a transient error into
    // null would bake a tagless, timerless notFound() — a permanent 404.
    console.error(`Error fetching tag by slug ${slug}:`, error);
    throw error;
  }
}

export async function getAllTagSlugs(): Promise<string[]> {
  try {
    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const result = await nextly.find({
          collection: "tags",
          limit: 1000,
          depth: 0,
        });
        return result.items.map(d => d.slug as string);
      },
      { tags: nextlyTags("tags"), keyParts: ["tags", "slugs"] }
    );
  } catch (error) {
    console.error("Error fetching all tag slugs:", error);
    return [];
  }
}

export async function getAllTagsWithCounts(): Promise<
  TaxonomyWithCount<Tag>[]
> {
  try {
    return await cachedFind(
      async () => {
        const nextly = await getNextly({ config: nextlyConfig });
        const all = await nextly.find({
          collection: "tags",
          limit: 1000,
          depth: 0,
        });
        return await Promise.all(
          all.items.map(async tag => {
            const tagId = String(tag.id);
            // No inner catch: a count failure must reject the whole read so the
            // outer fallback runs uncached, instead of caching a wrong zero
            // count until the next tag/post write busts the tag.
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
              item: toTag(tag),
              postCount: posts.meta.total,
            };
          })
        );
      },
      {
        tags: [...nextlyTags("tags"), ...nextlyTags("posts")],
        keyParts: ["tags", "with-counts"],
      }
    );
  } catch (error) {
    console.error("Error fetching tags with counts:", error);
    return [];
  }
}
