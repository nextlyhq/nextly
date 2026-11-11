/**
 * Where a plugin's own header item goes, and whether a person's-menu item is
 * well formed: read by the admin-meta serializer and by the start-up report,
 * so the two cannot disagree about which items are left out.
 *
 * @module plugins/header-item
 */
import { getNextlyLogger } from "../observability/logger";

import type {
  PluginAdminContributions,
  PluginItemPlace,
  PluginUserMenuItem,
} from "./admin-contributions";
import type { PluginDefinition } from "./plugin-context";
import { pluginAdminSlug } from "./plugin-slug";

/** The place a plugin's own item goes: the bar's right end unless it says. */
export function headerItemPlace(
  admin: PluginAdminContributions | undefined
): PluginItemPlace {
  return admin?.header?.place ?? "bar";
}

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/** Why an item's link-or-action cannot be followed, if it cannot. */
function targetProblem(to: unknown, action: unknown): string | undefined {
  if (to !== undefined && action !== undefined) {
    return "its item has both a link and an action";
  }
  if (to === undefined && action === undefined) {
    return "its item has neither a link nor an action";
  }
  return to !== undefined && !isText(to)
    ? "its item's link is empty"
    : undefined;
}

/**
 * Why a person's-menu item cannot be drawn, or `undefined` when it can. Read
 * as plain JavaScript hands it over, since a config may not be type-checked.
 */
function userMenuItemProblem(item: unknown): string | undefined {
  if (typeof item !== "object" || item === null) return "it declares no item";
  const { label, icon, to, action } = item as Record<string, unknown>;
  if (!isText(label)) return "its item has no label";
  if (!isText(icon)) return "its item has no icon";
  return targetProblem(to, action);
}

/**
 * The id a plugin's person's-menu item carries, `<plugin-slug>.user-menu`: the
 * `action` its route is called with, and the id the route is bound under.
 */
export function userMenuItemId(pluginName: string): string {
  return `${pluginAdminSlug(pluginName)}.user-menu`;
}

/** The plugin's person's-menu item, when it chose the menu and it is well formed. */
export function validUserMenuItem(
  admin: PluginAdminContributions | undefined
): PluginUserMenuItem | undefined {
  if (headerItemPlace(admin) !== "menu") return undefined;
  const item = admin?.header?.item;
  return userMenuItemProblem(item) === undefined ? item : undefined;
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
    const problem = userMenuItemProblem(admin?.header?.item);
    return problem === undefined ? [] : [`${plugin.name}: ${problem}`];
  });
}

/**
 * In development, report each person's-menu item that is left out. Silent
 * elsewhere: the item is simply not drawn, and a production log is no place
 * for a plugin author's mistake an operator cannot fix.
 */
export function reportUserMenuItemProblems(
  plugins: readonly PluginDefinition[]
): void {
  if (process.env.NODE_ENV !== "development") return;
  for (const problem of userMenuItemProblems(plugins)) {
    getNextlyLogger().warn({
      kind: "plugin-user-menu-item-left-out",
      message: `Person's-menu item left out, ${problem}. Declare a label, an icon, and either "to" or "action".`,
    });
  }
}
