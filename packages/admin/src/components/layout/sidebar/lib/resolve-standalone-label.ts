import type { StandalonePluginSummary } from "@admin/types/route-section";

/**
 * A standalone plugin plus the display label its panel may carry.
 *
 * Intersected with the shared summary rather than restated, because the route
 * registry names that type too and a second declaration of the same shape is
 * what lets the two drift. Only `appearance` is added: it is the one fact this
 * heading needs that the section resolver does not.
 */
export type LabelledStandalonePlugin = StandalonePluginSummary & {
  appearance?: { label?: string };
};

/**
 * The heading a standalone plugin's panel carries.
 *
 * A plugin may declare a display label; otherwise its name stands in, and the
 * slug is the last resort so a panel is never headed by nothing. Returns the
 * empty string when the selected rail item is not a standalone plugin at all,
 * which is what the caller renders as "no heading".
 *
 * @module components/layout/sidebar/lib/resolve-standalone-label
 */
export function resolveStandaloneLabel(
  selectedMain: string,
  visibleStandalonePlugins: readonly LabelledStandalonePlugin[],
  pluginSlug: (name: string) => string
): string {
  if (!selectedMain.startsWith("standalone-")) return "";
  const slug = selectedMain.replace("standalone-", "");
  const plugin = visibleStandalonePlugins.find(
    candidate => pluginSlug(candidate.name) === slug
  );
  return plugin?.appearance?.label || plugin?.name || slug;
}
