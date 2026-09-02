import type { PluginMetadata } from "@admin/types/branding";
import type { StandalonePluginSummary } from "@admin/types/route-section";

/**
 * A standalone plugin plus the display label its panel may carry.
 *
 * Both halves are derived rather than restated. `StandalonePluginSummary` is
 * deliberately narrow — its own docblock says so, to let callers pass a
 * literal — so it is intersected rather than widened, and `appearance` is
 * picked off `PluginMetadata` rather than re-spelled, so it tracks that type if
 * it gains a field.
 */
export type LabelledStandalonePlugin = StandalonePluginSummary &
  Pick<PluginMetadata, "appearance">;

/**
 * The heading a standalone plugin's panel carries.
 *
 * A plugin may declare a display label; otherwise its name stands in, and the
 * slug is the last resort so a panel is never headed by nothing. Returns the
 * empty string when the selected rail item is not a standalone plugin at all,
 * which is what the caller renders as "no heading".
 *
 * `||` rather than `??`, deliberately: `label` is free-form plugin config, so a
 * plugin can ship `label: ""`, and under `??` that empty string is a value and
 * heads the panel with nothing. Six other sites spell this rule and four of
 * them use `??`, so a reader finding them should not assume this one is the
 * stale copy.
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
