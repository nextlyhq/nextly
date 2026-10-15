/**
 * The widget declarations each enabled plugin contributes, as startup reads
 * them for the one store of declared widgets.
 *
 * Two readings of a plugin: the widgets it declares with `defineWidget()`
 * under `contributes.dashboard.widgets`, and the ids it declares in today's
 * shape under `contributes.admin.widgets`, which take part only in the id
 * rules. A disabled plugin contributes neither, as it contributes no other
 * admin surface (`contributedWidgetSummaries`).
 *
 * @module plugins/dashboard-declarations
 */

import type { LegacyWidgetIds } from "../domains/widgets/declaration/declared-widgets";
import type { WidgetDeclarationGroup } from "../domains/widgets/declaration/validate";

import type { PluginDefinition } from "./plugin-context";

/** How a fault names the plugin it is about. */
export const pluginOwner = (plugin: PluginDefinition): string =>
  `plugin "${plugin.name}"`;

const enabled = (plugins: readonly PluginDefinition[]) =>
  plugins.filter(plugin => plugin.enabled !== false);

/**
 * Each enabled plugin's declared widgets, as given: whatever sits under
 * `contributes.dashboard.widgets` is handed on unchecked, since startup checks
 * every declaration together and names whatever is wrong.
 */
export function pluginWidgetDeclarationGroups(
  plugins: readonly PluginDefinition[]
): WidgetDeclarationGroup[] {
  return enabled(plugins)
    .filter(plugin => plugin.contributes?.dashboard !== undefined)
    .map(plugin => ({
      owner: pluginOwner(plugin),
      declarations: plugin.contributes?.dashboard?.widgets,
    }));
}

/** The widget ids each enabled plugin declares in today's shape. */
export function pluginLegacyWidgetIds(
  plugins: readonly PluginDefinition[]
): LegacyWidgetIds[] {
  return enabled(plugins).flatMap(plugin => {
    const widgets: unknown = plugin.contributes?.admin?.widgets;
    if (!Array.isArray(widgets)) return [];
    const ids = widgets
      .map(widget => (widget as { id?: unknown } | null)?.id)
      .filter((id): id is string => typeof id === "string" && id !== "");
    return ids.length > 0 ? [{ owner: pluginOwner(plugin), ids }] : [];
  });
}
