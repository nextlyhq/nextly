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

import type {
  DeclaredWidgetGroup,
  LegacyWidgetIds,
} from "../domains/widgets/declaration/declared-widgets";
import type { WidgetDeclarationFault } from "../domains/widgets/declaration/validate";

import type { PluginDefinition } from "./plugin-context";
import { resolvePluginSelf } from "./self";

/** How a fault names the plugin it is about. */
export const pluginOwner = (plugin: PluginDefinition): string =>
  `plugin "${plugin.name}"`;

const enabled = (plugins: readonly PluginDefinition[]) =>
  plugins.filter(plugin => plugin.enabled !== false);

/**
 * A plugin's `contributes.dashboard`, as given: the one place startup reads
 * it, so each of its fields is read the same way, checked or not.
 */
function dashboardOf(
  plugin: PluginDefinition
): Partial<Record<string, unknown>> | undefined {
  const dashboard: unknown = plugin.contributes?.dashboard;
  return typeof dashboard === "object" && dashboard !== null
    ? dashboard
    : undefined;
}

/**
 * Each enabled plugin's declared widgets, as given: whatever sits under
 * `contributes.dashboard.widgets` is handed on unchecked, since startup checks
 * every declaration together and names whatever is wrong.
 *
 * With each, the slugs the plugin's own collections were renamed to, read from
 * `resolvePluginSelf` as `ctx.self` is: a widget's query names a collection as
 * the plugin declared it, and the site may have renamed it.
 */
export function pluginWidgetDeclarationGroups(
  plugins: readonly PluginDefinition[]
): DeclaredWidgetGroup[] {
  return (
    enabled(plugins)
      // Any dashboard at all, so one that is not an object is still checked
      // and named, rather than passed over.
      .filter(plugin => plugin.contributes?.dashboard !== undefined)
      .map(plugin => ({
        owner: pluginOwner(plugin),
        declarations: dashboardOf(plugin)?.widgets,
        collections: resolvePluginSelf(plugin).collections,
      }))
  );
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

/** The ids a plugin declares under `contributes.dashboard.widgets`. */
function ownIds(plugin: PluginDefinition): ReadonlySet<string> {
  const widgets = dashboardOf(plugin)?.widgets;
  if (!Array.isArray(widgets)) return new Set();
  return new Set(
    widgets
      .map(widget => (widget as { id?: unknown } | null)?.id)
      .filter((id): id is string => typeof id === "string")
  );
}

/** A plugin's `suggest`, as given, which startup checks. */
function suggestionsOf(plugin: PluginDefinition): unknown {
  return dashboardOf(plugin)?.suggest;
}

/** A plugin's `alternatives`, as given, which startup checks. */
function alternativesOf(plugin: PluginDefinition): unknown {
  return dashboardOf(plugin)?.alternatives;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function suggestFaults(plugin: PluginDefinition): WidgetDeclarationFault[] {
  const suggest = suggestionsOf(plugin);
  if (suggest === undefined) return [];
  const owner = pluginOwner(plugin);
  if (!Array.isArray(suggest)) {
    return [
      {
        owner,
        widget: "(suggest)",
        problem: "suggest must be a list of the plugin's own widget ids",
      },
    ];
  }
  const own = ownIds(plugin);
  return suggest
    .filter(id => typeof id !== "string" || !own.has(id))
    .map(id => ({
      owner,
      widget: String(id),
      problem: `suggests "${String(id)}", which is not one of its own widgets`,
    }));
}

function alternativeFaults(
  plugin: PluginDefinition,
  coreIds: ReadonlySet<string>
): WidgetDeclarationFault[] {
  const alternatives = alternativesOf(plugin);
  if (alternatives === undefined) return [];
  const owner = pluginOwner(plugin);
  if (!isRecord(alternatives)) {
    return [
      {
        owner,
        widget: "(alternatives)",
        problem:
          "alternatives must be an object from its own widget id to a built-in widget id",
      },
    ];
  }
  const own = ownIds(plugin);
  return Object.entries(alternatives).flatMap(([id, core]) => [
    ...(own.has(id)
      ? []
      : [
          {
            owner,
            widget: id,
            problem: `offers "${id}" as an alternative, which is not one of its own widgets`,
          },
        ]),
    ...(typeof core === "string" && coreIds.has(core)
      ? []
      : [
          {
            owner,
            widget: id,
            problem: `offers "${id}" in place of ${JSON.stringify(core)}, which is not a built-in widget`,
          },
        ]),
  ]);
}

/**
 * Every fault in the enabled plugins' `suggest` and `alternatives`: a plugin
 * may suggest or offer only its own widgets, and offer one only in place of a
 * built-in that exists. A plugin has no other way to touch the dashboard.
 */
export function pluginSuggestionFaults(
  plugins: readonly PluginDefinition[],
  coreIds: ReadonlySet<string>
): WidgetDeclarationFault[] {
  return enabled(plugins).flatMap(plugin => [
    ...suggestFaults(plugin),
    ...alternativeFaults(plugin, coreIds),
  ]);
}

/**
 * Each alternative the enabled plugins offer, by its widget id, with the
 * built-in it may replace: what the site config's `replace` may choose from.
 */
export function pluginAlternatives(
  plugins: readonly PluginDefinition[]
): ReadonlyMap<string, string> {
  const offered = new Map<string, string>();
  for (const plugin of enabled(plugins)) {
    const alternatives = alternativesOf(plugin);
    if (!isRecord(alternatives)) continue;
    for (const [id, core] of Object.entries(alternatives)) {
      if (typeof core === "string") offered.set(id, core);
    }
  }
  return offered;
}
