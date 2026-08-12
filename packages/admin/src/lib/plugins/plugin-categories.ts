/**
 * The category vocabulary, from core, plus the admin's labels for it.
 *
 * The vocabulary itself is core's: it is what `definePlugin` accepts, so a
 * second list here would let the catalogue reject a category a plugin can
 * legally declare, or accept one it cannot. Only the human labels are the
 * admin's own, because only the admin renders them.
 *
 * The vocabulary is deliberately narrow. `marketing` and `storage` are NOT
 * members and are the two most commonly reached for: an SEO plugin is `seo`,
 * and a storage adapter is `integration` or `media` depending on whether it is
 * the transport or the asset handling that matters to the reader.
 *
 * @module lib/plugins/plugin-categories
 */
import {
  PLUGIN_CATEGORIES,
  isPluginCategory,
  type PluginCategory,
} from "nextly/config";

export { PLUGIN_CATEGORIES, isPluginCategory, type PluginCategory };

/**
 * Human labels for the vocabulary.
 *
 * `Record<PluginCategory, string>` rather than a partial map: adding a
 * category to core without a label here is then a type error at build time
 * instead of a raw slug appearing in the UI.
 */
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

/** The label for a category, or the raw value when a plugin declares its own. */
export function categoryLabel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return isPluginCategory(value) ? CATEGORY_LABELS[value] : value;
}
