/**
 * The controlled vocabulary a plugin declares in `category`.
 *
 * This lived inside the plugin detail page component until a second page
 * needed it. A page component is the wrong home for a vocabulary two pages
 * share: the second consumer copies it, and the copies drift.
 *
 * The vocabulary is deliberately narrow. `marketing` and `storage` are NOT
 * members and are the two most commonly reached for: an SEO plugin is `seo`,
 * and a storage adapter is `integration` or `media` depending on whether it is
 * the transport or the asset handling that matters to the reader.
 *
 * @module lib/plugins/plugin-categories
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

/** Human labels for the vocabulary. */
export const CATEGORY_LABELS: Record<PluginCategory, string> = {
  content: "Content",
  forms: "Forms",
  seo: "SEO",
  media: "Media",
  commerce: "Commerce",
  integration: "Integration",
  "dev-tools": "Dev Tools",
  other: "Other",
};

/**
 * Narrow a plugin's free-form `category` to the vocabulary.
 *
 * A third-party plugin can declare anything, so callers rendering
 * `PluginMetadata` must keep tolerating an unknown value rather than throwing.
 * This exists so our OWN catalogue can be checked at build time instead.
 */
export function isPluginCategory(
  value: string | undefined
): value is PluginCategory {
  return (
    value !== undefined &&
    (PLUGIN_CATEGORIES as readonly string[]).includes(value)
  );
}

/** The label for a category, or the raw value when a plugin declares its own. */
export function categoryLabel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return isPluginCategory(value) ? CATEGORY_LABELS[value] : value;
}
