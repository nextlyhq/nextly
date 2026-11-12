/**
 * Where a plugin's own header item goes, which component it mounts, and
 * whether a person's-menu item is well formed: read by the admin-meta
 * serializer, the route binding, the component import map and the start-up
 * report, so none of them can disagree about which items are left out.
 *
 * @module plugins/header-item
 */
import type { Logger } from "../shared/types";

import type {
  ComponentPath,
  PluginAdminContributions,
  PluginItemPlace,
  PluginUserMenuItem,
} from "./admin-contributions";
import { actionProblem } from "./admin-place-contributions";
import type { PluginDefinition } from "./plugin-context";
import { pluginAdminSlug } from "./plugin-slug";

/** The place a plugin's own item goes: the bar's right end unless it says. */
export function headerItemPlace(
  admin: PluginAdminContributions | undefined
): PluginItemPlace {
  return admin?.header?.place ?? "bar";
}

/**
 * The component a plugin's own item mounts, at the bar or the rail's foot.
 * `header.slot` supersedes the deprecated `headerSlot`. None for the menu,
 * which never mounts one, whatever else the config still carries.
 */
export function headerSlotOf(
  admin: PluginAdminContributions | undefined
): ComponentPath | undefined {
  if (headerItemPlace(admin) === "menu") return undefined;
  return admin?.header?.slot ?? admin?.headerSlot;
}

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/**
 * Why an item's link or action cannot be followed, if it cannot. An action is
 * read as a list action's is, so one naming no component, or no staff route
 * of the plugin's own, is left out.
 */
function targetProblem(
  item: Record<string, unknown>,
  plugin: PluginDefinition
): string | undefined {
  const { to, action } = item;
  if (to !== undefined && action !== undefined) {
    return "its item has both a link and an action";
  }
  if (to === undefined && action === undefined) {
    return "its item has neither a link nor an action";
  }
  if (to !== undefined) {
    return isText(to) ? undefined : "its item's link is empty";
  }
  return actionProblem(action, plugin);
}

/**
 * Why a person's-menu item cannot be drawn, or `undefined` when it can. Read
 * as plain JavaScript hands it over, since a config may not be type-checked.
 */
function userMenuItemProblem(
  item: unknown,
  plugin: PluginDefinition
): string | undefined {
  if (typeof item !== "object" || item === null) return "it declares no item";
  const fields = item as Record<string, unknown>;
  if (!isText(fields.label)) return "its item has no label";
  if (!isText(fields.icon)) return "its item has no icon";
  return targetProblem(fields, plugin);
}

/**
 * The id a plugin's person's-menu item carries, `<plugin-slug>.user-menu`: the
 * `action` its route is called with, and the id the route is bound under.
 */
export function userMenuItemId(pluginName: string): string {
  return `${pluginAdminSlug(pluginName)}.user-menu`;
}

/**
 * The plugin's person's-menu item, when it chose the menu and the item is well
 * formed: the one validated reading every consumer takes it through.
 */
export function validUserMenuItem(
  plugin: PluginDefinition
): PluginUserMenuItem | undefined {
  const admin = plugin.contributes?.admin;
  if (headerItemPlace(admin) !== "menu") return undefined;
  const item = admin?.header?.item;
  return userMenuItemProblem(item, plugin) === undefined ? item : undefined;
}

/**
 * One line per enabled plugin whose person's-menu item is left out, naming the
 * plugin and why.
 */
function userMenuItemProblems(plugins: readonly PluginDefinition[]): string[] {
  return plugins.flatMap(plugin => {
    const admin = plugin.contributes?.admin;
    if (plugin.enabled === false || headerItemPlace(admin) !== "menu") {
      return [];
    }
    const problem = userMenuItemProblem(admin?.header?.item, plugin);
    return problem === undefined ? [] : [`${plugin.name}: ${problem}`];
  });
}

/**
 * In development, report each person's-menu item that is left out, to the
 * host's logger. Silent elsewhere: the item is simply not drawn, and a
 * production log is no place for a plugin author's mistake an operator cannot
 * fix.
 */
export function reportUserMenuItemProblems(
  plugins: readonly PluginDefinition[],
  logger: Logger
): void {
  if (process.env.NODE_ENV !== "development") return;
  for (const problem of userMenuItemProblems(plugins)) {
    logger.warn?.(
      `Person's-menu item left out, ${problem}. Declare a label, an icon, and either "to" or "action".`,
      { kind: "plugin-user-menu-item-left-out" }
    );
  }
}
