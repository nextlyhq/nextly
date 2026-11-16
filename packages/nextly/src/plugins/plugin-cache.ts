/**
 * `ctx.cache`: the cache tags of a plugin's own data, and their expiry.
 *
 * A content write expires the tags of what it changed. A plugin's own data
 * (its settings, its redirects) changes through no content write, so a page
 * built from it would stay cached until a redeploy. A plugin tags the reads it
 * builds from that data with `tag()`, and expires them with `expire()` when the
 * data changes. Both spell tags with `pluginCacheTag` under the plugin's own
 * name, so a plugin can expire only its own tags, never content's or another
 * plugin's.
 *
 * @module plugins/plugin-cache
 */
import { flushContentChange } from "../domains/flush-content-change";
import { getNextlyLogger } from "../observability/logger";
import { pluginCacheTag } from "../revalidation/compute-tags";

/**
 * @experimental A plugin's cache tags, and their expiry.
 *
 * `tag` and `tags` name the tags a read built from the plugin's data carries;
 * `expire` clears every cached read carrying them, on every instance that
 * shares the database, as a content write clears its own.
 */
export interface PluginCacheApi {
  /** The tag a read of `part` of this plugin's data carries. */
  tag(part: string): string;
  /** The tags of several parts, in order. */
  tags(...parts: string[]): string[];
  /**
   * Expire every cached read tagged with these parts. Best-effort, like the
   * expiry after a content write: a cache that cannot be reached is logged,
   * and the plugin's own write is not failed by it. A blank part is refused
   * before anything is expired.
   */
  expire(...parts: string[]): Promise<void>;
}

/** The cache tags of the plugin named `owner`. */
export function createPluginCache(owner: string): PluginCacheApi {
  const tag = (part: string) => pluginCacheTag(owner, part);
  return {
    tag,
    tags: (...parts) => parts.map(tag),
    expire: async (...parts) => {
      // Every tag is spelled before the cache is asked, so a refused part
      // expires nothing rather than some of the parts.
      const tags = [...new Set(parts.map(tag))];
      await flushContentChange(
        { tags },
        {
          error: (message, context) =>
            getNextlyLogger().error({
              kind: "plugin-cache-expiry-failed",
              plugin: owner,
              message,
              ...context,
            }),
        },
        "a plugin expired its cached pages"
      );
    },
  };
}
