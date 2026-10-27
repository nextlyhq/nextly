/**
 * What an admin screen is called, for the browser tab.
 *
 * Each route in the route table declares its screen's name beside the rail
 * section it declares, so a route added without one fails to compile rather
 * than leaving a tab unnamed. Where the sidebar already names the destination,
 * the declaration READS that label instead of spelling it again: the tab and
 * the entry a reader clicked to get there are one name, and renaming the entry
 * renames the tab. Literals are left only for screens nothing in the sidebar
 * names, such as the signed-out screens.
 *
 * Screens that show one item (an entry, a webhook) add the item's name through
 * `useDocumentTitle`; this module names the screen only.
 *
 * @module lib/navigation/screen-names
 */
import { SETTINGS_NAV } from "@admin/components/layout/sidebar/lib/settings-nav";
import { MAIN_MENU_ITEMS } from "@admin/components/layout/sidebar/sidebar-types";
import type { NavSection } from "@admin/constants/nav-sections";
import type { PluginMenuItemMeta, PluginMetadata } from "@admin/types/branding";
import type { ApiSingle } from "@admin/types/entities";

/**
 * The data a screen's name may depend on, beyond the route itself.
 *
 * Supplied by the title provider from answers the admin already holds: the
 * collection or Single a content route opens, as the sidebar's lists carry
 * them, and the plugin list from admin-meta. Each is absent until it arrives.
 */
/**
 * What naming a collection reads: the fields its sidebar label is made from.
 * Stated as that shape rather than one of the admin's collection types, since
 * the label may come from the sidebar's list or from a screen's own read of
 * the collection, and those answers are typed differently.
 */
export interface NamedCollection {
  name: string;
  label?: string;
  labels?: { plural?: string };
}

export interface ScreenNameSources {
  pathname: string;
  collection?: NamedCollection;
  single?: Pick<ApiSingle, "slug" | "label">;
  plugins?: readonly PluginMetadata[];
}

/**
 * A screen's name: fixed, or read when the title is composed.
 *
 * A function rather than a value for two reasons. Some names depend on data the
 * address does not carry (which collection is open). And a name read from the
 * sidebar's declarations is looked up when asked rather than at module load, so
 * a missing entry yields no name instead of failing the route table's import.
 */
export type ScreenName =
  | string
  | ((sources: ScreenNameSources) => string | undefined);

/** The name a declaration gives, with an empty one counted as none. */
export function resolveScreenName(
  name: ScreenName | undefined,
  sources: ScreenNameSources
): string | undefined {
  const resolved = typeof name === "function" ? name(sources) : name;
  return resolved?.trim() || undefined;
}

/**
 * The rail entry's label for a top-level destination (Dashboard, Media
 * Library, Email, ...), as the rail's own tooltip shows it.
 */
export function railScreen(section: NavSection): ScreenName {
  return () => MAIN_MENU_ITEMS.find(item => item.id === section)?.label;
}

/**
 * The settings panel's label for the destination at `href` (Webhooks, API
 * Keys, Roles, ...). Screens reached from that destination, such as its create
 * and edit forms, declare the same name; the item they show tells them apart.
 */
export function settingsScreen(href: string): ScreenName {
  return () =>
    SETTINGS_NAV.flatMap(group => group.items).find(item => item.href === href)
      ?.label;
}

/**
 * A collection's screens are called what the sidebar lists the collection
 * as: its plural label, then its label, then its name.
 */
export const collectionScreen: ScreenName = ({ collection }) =>
  collection
    ? collection.labels?.plural || collection.label || collection.name
    : undefined;

/** A Single's screens are called by the Single's label, else its slug. */
export const singleScreen: ScreenName = ({ single }) =>
  single ? single.label || single.slug : undefined;

/** The plugin menu entries, children included, as one list to search. */
function flattenMenu(
  items: readonly PluginMenuItemMeta[]
): PluginMenuItemMeta[] {
  return items.flatMap(item => [item, ...flattenMenu(item.children ?? [])]);
}

/**
 * The path an address names: no query, no hash, and no trailing slash. A menu
 * entry may link to a filtered view (`?status=open`) or a place on the page
 * (`#unread`), but the route is resolved from the path alone, so the two are
 * compared on that.
 */
function pathOf(address: string): string {
  const path = address.split(/[?#]/, 1)[0] ?? "";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * A plugin's page is called by the menu entry that links to it, and by its
 * address when the plugin gave it none. The admin knows nothing else about a
 * plugin's page, and the address is at least what the reader can see.
 */
export const pluginPageScreen: ScreenName = ({ pathname, plugins }) => {
  const path = pathOf(pathname);
  const entry = flattenMenu(
    (plugins ?? []).flatMap(plugin => plugin.menu ?? [])
  ).find(item => pathOf(item.to) === path);
  return entry?.label ?? pathname;
};

/** The separator between a title's parts, as in "Posts · Golden Shop". */
const SEPARATOR = " · ";

/**
 * The tab title: the item, the screen and the site, most specific first, so a
 * row of narrow tabs still shows what differs between them. A part with
 * nothing to say is left out rather than shown empty.
 */
export function formatDocumentTitle(parts: {
  item?: string;
  screen?: string;
  site: string;
}): string {
  return [parts.item, parts.screen, parts.site]
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(SEPARATOR);
}
