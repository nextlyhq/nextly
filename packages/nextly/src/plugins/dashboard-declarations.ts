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
import { quote } from "../domains/widgets/declaration/quote";
import { unknownKeyProblems } from "../domains/widgets/declaration/site-dashboard";
import type { WidgetDeclarationFault } from "../domains/widgets/declaration/validate";

import type { PluginDefinition } from "./plugin-context";
import { resolvePluginSelf } from "./self";

/** How a fault names the plugin it is about. */
export const pluginOwner = (plugin: PluginDefinition): string =>
  `plugin "${plugin.name}"`;

const enabled = (plugins: readonly PluginDefinition[]) =>
  plugins.filter(plugin => plugin.enabled !== false);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * One enabled plugin's `contributes.dashboard`, read ONCE at startup. Its
 * widgets, suggestions and alternatives are all taken from this copy, so a
 * plain JavaScript plugin whose contribution answers differently on each read
 * cannot have one widget registered and another suggested.
 */
export interface PluginDashboardSnapshot {
  readonly owner: string;
  /** Its `widgets`, as given: startup checks every declaration. */
  readonly widgets: unknown;
  /** Its `suggest`, copied where it is a list. */
  readonly suggest: unknown;
  /** Its `alternatives`, copied where it is an object. */
  readonly alternatives: unknown;
  /** Declared slug to the slug the site uses, for the plugin's collections. */
  readonly collections?: Readonly<Record<string, string>>;
  /** Each key it carries that a contribution does not take, as a fault's words. */
  readonly unknownKeys: readonly string[];
}

/** The keys `contributes.dashboard` takes. */
const DASHBOARD_CONTRIBUTION_KEYS = [
  "widgets",
  "suggest",
  "alternatives",
  "attention",
] as const;

/**
 * Each enabled plugin with any dashboard contribution at all, read once: one
 * that is not an object is still taken, so its fault is named rather than the
 * contribution passed over.
 *
 * With each, the slugs the plugin's own collections were renamed to, read from
 * `resolvePluginSelf` as `ctx.self` is: a widget's query names a collection as
 * the plugin declared it, and the site may have renamed it.
 */
export function pluginDashboardSnapshots(
  plugins: readonly PluginDefinition[]
): PluginDashboardSnapshot[] {
  return enabled(plugins).flatMap(plugin => {
    const given: unknown = plugin.contributes?.dashboard;
    if (given === undefined) return [];
    const fields = isRecord(given) ? given : {};
    const { widgets, suggest, alternatives } = fields;
    return [
      {
        owner: pluginOwner(plugin),
        widgets,
        suggest: Array.isArray(suggest) ? [...(suggest as unknown[])] : suggest,
        alternatives: isRecord(alternatives)
          ? Object.fromEntries(Object.entries(alternatives))
          : alternatives,
        collections: resolvePluginSelf(plugin).collections,
        // A misspelt key would otherwise be dropped here, and what it asked for
        // would silently never happen.
        unknownKeys: unknownKeyProblems(
          "contributes.dashboard",
          fields,
          DASHBOARD_CONTRIBUTION_KEYS
        ),
      },
    ];
  });
}

/**
 * Each snapshotted plugin's declared widgets, as given: whatever sits under
 * `widgets` is handed on unchecked, since startup checks every declaration
 * together and names whatever is wrong.
 */
export function pluginWidgetDeclarationGroups(
  dashboards: readonly PluginDashboardSnapshot[]
): DeclaredWidgetGroup[] {
  return dashboards.map(({ owner, widgets, collections }) => ({
    owner,
    declarations: widgets,
    ...(collections === undefined ? {} : { collections }),
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

/**
 * The ids `owner` declares, read from the declarations as startup snapshotted
 * and kept them, never from a second read of the plugin.
 */
function ownIds(
  owner: string,
  groups: readonly DeclaredWidgetGroup[]
): ReadonlySet<string> {
  const declarations = groups.find(
    group => group.owner === owner
  )?.declarations;
  if (!Array.isArray(declarations)) return new Set();
  return new Set(
    (declarations as readonly unknown[])
      .map(widget => (isRecord(widget) ? widget.id : undefined))
      .filter((id): id is string => typeof id === "string")
  );
}

function suggestFaults(
  dashboard: PluginDashboardSnapshot,
  own: ReadonlySet<string>
): WidgetDeclarationFault[] {
  const { owner, suggest } = dashboard;
  if (suggest === undefined) return [];
  if (!Array.isArray(suggest)) {
    return [
      {
        owner,
        widget: "(suggest)",
        problem: "suggest must be a list of the plugin's own widget ids",
      },
    ];
  }
  return (suggest as readonly unknown[])
    .filter(id => typeof id !== "string" || !own.has(id))
    .map(id => ({
      owner,
      widget: typeof id === "string" ? id : "(suggest)",
      problem: `suggests ${quote(id)}, which is not one of its own widgets`,
    }));
}

function alternativeFaults(
  dashboard: PluginDashboardSnapshot,
  own: ReadonlySet<string>,
  coreIds: ReadonlySet<string>
): WidgetDeclarationFault[] {
  const { owner, alternatives } = dashboard;
  if (alternatives === undefined) return [];
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
            problem: `offers "${id}" in place of ${quote(core)}, which is not a built-in widget`,
          },
        ]),
  ]);
}

/**
 * Every fault in the plugins' `suggest` and `alternatives`: a plugin may
 * suggest or offer only its own widgets, and offer one only in place of a
 * built-in that exists. A plugin has no other way to touch the dashboard.
 * Ownership is read from the declarations startup snapshotted (`groups`).
 */
export function pluginSuggestionFaults(
  dashboards: readonly PluginDashboardSnapshot[],
  groups: readonly DeclaredWidgetGroup[],
  coreIds: ReadonlySet<string>
): WidgetDeclarationFault[] {
  return dashboards.flatMap(dashboard => {
    const own = ownIds(dashboard.owner, groups);
    return [
      ...dashboard.unknownKeys.map(problem => ({
        owner: dashboard.owner,
        widget: "(contributes.dashboard)",
        problem,
      })),
      ...suggestFaults(dashboard, own),
      ...alternativeFaults(dashboard, own, coreIds),
    ];
  });
}

/**
 * Each alternative the plugins offer, by its widget id, with the built-in it
 * may replace: what the site config's `replace` may choose from.
 */
export function pluginAlternatives(
  dashboards: readonly PluginDashboardSnapshot[]
): ReadonlyMap<string, string> {
  const offered = new Map<string, string>();
  for (const { alternatives } of dashboards) {
    if (!isRecord(alternatives)) continue;
    for (const [id, core] of Object.entries(alternatives)) {
      if (typeof core === "string") offered.set(id, core);
    }
  }
  return offered;
}
