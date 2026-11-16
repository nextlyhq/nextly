/**
 * The permission a plugin's settings page asks.
 *
 * The plugin's own, where its metadata names one, else core's default, a
 * settings change. Asked by the settings page's gate, by the link to it on
 * the plugin's detail page and by the plugins panel's links to it, so a link
 * is offered only to a caller the page will let in.
 */
import { buildRoute, ROUTES } from "@admin/constants/routes";
import { UPDATE_SETTINGS } from "@admin/lib/permissions/system-policy";
import { pluginSlug } from "@admin/lib/plugins/plugin-slug";
import type { PluginMetadata } from "@admin/types/branding";

export function pluginSettingsPermission(
  plugin: PluginMetadata | undefined
): string {
  return plugin?.settings?.permission ?? UPDATE_SETTINGS;
}

/** A link to one plugin's settings page, as the plugins panel lists it. */
export interface PluginSettingsLink {
  slug: string;
  label: string;
  href: string;
}

/**
 * The plugin settings pages this reader may open but cannot reach through the
 * plugins overview.
 *
 * A settings manager reaches every plugin's settings from `/admin/plugins`
 * and each plugin's page, both guarded by `manage-settings`, so they are
 * offered none here. Anyone else reaches a settings page only by a link that
 * leads straight to it, and only where its gate, the permission the plugin
 * names, lets them in: a plugin that keeps its settings to a role of its own
 * gives that role this link. A disabled plugin's settings do not load, and a
 * plugin without settings has no page, so neither is offered.
 *
 * One function for the panel that draws the links and the rail that decides
 * whether the panel has anything to show, so the two cannot disagree.
 */
export function pluginSettingsLinks(
  plugins: PluginMetadata[] | undefined,
  reader: {
    canManageSettings: boolean;
    hasPermission: (slug: string) => boolean;
  }
): PluginSettingsLink[] {
  if (reader.canManageSettings || !plugins) return [];
  return plugins
    .filter(
      plugin =>
        plugin.enabled !== false &&
        plugin.settings !== undefined &&
        reader.hasPermission(pluginSettingsPermission(plugin))
    )
    .map(plugin => {
      const slug = pluginSlug(plugin.name);
      return {
        slug,
        label: `${plugin.appearance?.label ?? plugin.name} settings`,
        href: buildRoute(ROUTES.PLUGIN_SETTINGS, { slug }),
      };
    });
}
