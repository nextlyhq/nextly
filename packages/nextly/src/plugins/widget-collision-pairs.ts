/**
 * A widget registered with an id a plugin also contributes, checked as the one
 * widget the admin draws from the two.
 *
 * Each channel is checked on its own at its door (`registerWidget` validates a
 * definition, `assertAdminWidgets` a contribution), but a collision is drawn
 * from a MERGE of them: the admin's `mergeCollision` takes the registration's
 * query and cells, and its settings or, where it declares none, the
 * contribution's. That pair is one neither door ever saw. A registration's
 * ranged query beside a contribution's `limit` setting, or its query beside a
 * content setting no knob drives on that query's source, passes both doors and
 * fails every request the card makes. So after every plugin has registered,
 * each colliding pair is checked by the rules a single declaration is held to,
 * and startup stops on any fault, all of them named at once.
 *
 * @module plugins/widget-collision-pairs
 */

import type { WidgetDefinition } from "../domains/widgets/definition";
import { rangedLimitSettingProblem } from "../domains/widgets/definition";
import { publishableWidgets } from "../domains/widgets/publish";
import {
  settingsSourceOf,
  widgetSettingsProblem,
} from "../domains/widgets/settings";
import { NextlyError } from "../errors/nextly-error";

import type { PluginAdminWidget } from "./admin-contributions";
import type { PluginDefinition } from "./plugin-context";
import { validatedAdminWidgets } from "./validate-admin-widgets";

/** One colliding pair that cannot work, with the plugin that contributed it. */
export interface CollisionPairFault {
  plugin: string;
  widget: string;
  problem: string;
}

/**
 * The query, cells and settings the admin's `mergeCollision` draws a colliding
 * widget from: the registration's query, its cells only where its archetype
 * draws cells, and its settings or else the contribution's.
 */
function mergedPair(
  registration: WidgetDefinition,
  contribution: PluginAdminWidget
): { query: unknown; cells: unknown; settings: unknown } {
  const contributed = (contribution as { settings?: unknown }).settings;
  return {
    query: registration.query,
    cells:
      registration.archetype === "stats" || registration.archetype === "custom"
        ? registration.cells
        : undefined,
    settings: registration.settings ?? contributed,
  };
}

/**
 * Each enabled plugin's contributed widgets by id, the first plugin's where two
 * share one, as the admin and the canonical set keep the first.
 */
function contributedById(
  plugins: readonly PluginDefinition[]
): ReadonlyMap<string, { plugin: string; widget: PluginAdminWidget }> {
  const byId = new Map<string, { plugin: string; widget: PluginAdminWidget }>();
  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    for (const widget of validatedAdminWidgets(plugin) ?? []) {
      if (!byId.has(widget.id)) {
        byId.set(widget.id, { plugin: plugin.name, widget });
      }
    }
  }
  return byId;
}

/** Every colliding pair the admin would draw that the declaration rules refuse. */
export function collisionPairFaults(
  plugins: readonly PluginDefinition[]
): CollisionPairFault[] {
  const contributed = contributedById(plugins);
  return publishableWidgets().flatMap(registration => {
    const found = contributed.get(registration.id);
    if (found === undefined) return [];
    const pair = mergedPair(registration, found.widget);
    const problem =
      rangedLimitSettingProblem(pair) ??
      widgetSettingsProblem(
        pair.settings,
        registration.serverData === true,
        settingsSourceOf(pair)
      );
    return problem === undefined
      ? []
      : [{ plugin: found.plugin, widget: registration.id, problem }];
  });
}

/** Stops startup naming every colliding pair that cannot work. */
export function assertCollisionPairs(
  plugins: readonly PluginDefinition[]
): void {
  const faults = collisionPairFaults(plugins);
  if (faults.length === 0) return;
  throw new NextlyError({
    code: "NEXTLY_PLUGIN_ADMIN_WIDGET_INVALID",
    publicMessage: "Plugin configuration is invalid.",
    logMessage: [
      `${faults.length} widget${faults.length === 1 ? "" : "s"} registered over a plugin's contribution cannot work as merged. Fix each, then restart:`,
      ...faults.map(
        fault =>
          `- widget "${fault.widget}", registered over plugin "${fault.plugin}"'s contribution: ${fault.problem}`
      ),
    ].join("\n"),
    logContext: { faults },
  });
}
