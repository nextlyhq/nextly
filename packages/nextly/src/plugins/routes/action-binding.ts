/**
 * Which of a plugin's declared actions run one of its routes: what binds the
 * route, so that every request to it is checked as one of those actions.
 *
 * Asked where the route is registered, of the same plugin definition the
 * route comes from, rather than of whatever plugin list is configured when a
 * request arrives: a list rewritten after boot (a `setup` transformer) would
 * otherwise read a bound route as unbound, and an unbound route is not
 * checked at all.
 *
 * @module plugins/routes/action-binding
 * @experimental
 */
import type {
  AdminContribution,
  AdminContributionAction,
} from "../admin-contributions";
import { userMenuItemId, validUserMenuItem } from "../header-item";
import type { PluginDefinition } from "../plugin-context";
import {
  collectionContributors,
  servedCollectionSlug,
} from "../served-collection-slug";

import type { BoundAction } from "./action-route-check";
import type { PluginRoute } from "./route-types";

/** A declared row or bulk action that runs a route. */
type RunAction = Extract<
  AdminContribution,
  { kind: "rowAction" | "bulkAction" }
>;

/** Whether a declared action calls `route`, by method, path and mount. */
function actionRuns(
  action: AdminContributionAction,
  route: PluginRoute
): boolean {
  if (!("run" in action)) return false;
  return (
    action.run.method === route.method &&
    action.run.path === route.path &&
    (action.run.mount ?? "plugin") === (route.mount ?? "plugin")
  );
}

/** Whether a declared contribution is an action that runs `route`. */
function runs(contribution: AdminContribution, route: PluginRoute): boolean {
  if (contribution.kind !== "rowAction" && contribution.kind !== "bulkAction") {
    return false;
  }
  return actionRuns(contribution.action, route);
}

/**
 * The plugin's person's-menu item, bound to `route` when its action runs it:
 * called on no rows, under the item's id. Read through the one validated
 * reading of the item, which takes an action only as a list action's is
 * taken, naming one of the plugin's own staff routes.
 */
function boundMenuAction(
  plugin: PluginDefinition,
  route: PluginRoute
): BoundAction[] {
  const action = validUserMenuItem(plugin)?.action;
  if (action === undefined || !actionRuns(action, route)) return [];
  return [{ id: userMenuItemId(plugin.name), kind: "userMenuItem" }];
}

/**
 * @experimental The actions of `plugin` that run `route`, as the check reads
 * them: each named collection under the slug it is served as, through the
 * plugin that contributes it, and the person's-menu item when it runs the
 * route. Read from the declarations boot has already
 * checked, so a malformed one never reaches here.
 */
export function boundActionsOf(
  plugin: PluginDefinition,
  route: PluginRoute,
  plugins: readonly PluginDefinition[]
): BoundAction[] {
  if (plugin.enabled === false) return [];
  const contributors = collectionContributors(plugins);
  const listActions = (plugin.contributes?.admin?.contributions ?? [])
    .filter(contribution => runs(contribution, route))
    .map((contribution): BoundAction => {
      const action = contribution as RunAction;
      return {
        id: action.id,
        kind: action.kind,
        ...(action.collections
          ? {
              collections: action.collections.map(slug =>
                servedCollectionSlug(plugin, slug, contributors)
              ),
            }
          : {}),
        ...(action.requiredPermission !== undefined
          ? { requiredPermission: action.requiredPermission }
          : {}),
        ...(action.visibleWhen ? { visibleWhen: action.visibleWhen } : {}),
      };
    });
  return [...listActions, ...boundMenuAction(plugin, route)];
}
