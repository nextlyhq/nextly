/**
 * The controlled vocabulary a plugin declares in `category`.
 *
 * Its own module, with no imports, so `nextly/config` can export it to the
 * admin without pulling in the plugin runtime. `plugin-context.ts` reaches the
 * event bus, the filter registry and the DI container; a client bundle that
 * only wants the list of categories must not pay for any of that.
 *
 * @module nextly/plugins/plugin-categories
 */

/**
 * Deliberately short: a category is only useful when several plugins can share
 * it, so new values are added here rather than typed ad hoc.
 *
 * A runtime array rather than a bare union, because consumers need to iterate
 * it to build a filter and to narrow a third-party plugin's free-form
 * `category`. A union alone cannot be enumerated at runtime, so a consumer
 * that needs the values has no option but to write them out again, and that
 * copy starts accepting a category plugins cannot declare the moment either
 * side changes.
 */
export const PLUGIN_CATEGORIES = [
  "content",
  "forms",
  "seo",
  "media",
  "commerce",
  "integration",
  "dev-tools",
  "other",
] as const;

export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

/**
 * Narrow a free-form `category` to the vocabulary.
 *
 * A third-party plugin can declare anything, so a surface rendering plugin
 * metadata must keep tolerating an unknown value rather than throwing. This
 * exists so first-party data can be checked instead of assumed.
 */
export function isPluginCategory(
  value: string | undefined
): value is PluginCategory {
  return (
    value !== undefined &&
    (PLUGIN_CATEGORIES as readonly string[]).includes(value)
  );
}
