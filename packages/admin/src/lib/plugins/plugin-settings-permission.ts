/**
 * The permission a plugin's settings page asks.
 *
 * The plugin's own, where its metadata names one, else core's default, a
 * settings change. Asked by the settings page's gate and by the link to it on
 * the plugin's detail page, so a link is offered only to a caller the page
 * will let in.
 */
import { UPDATE_SETTINGS } from "@admin/lib/permissions/system-policy";
import type { PluginMetadata } from "@admin/types/branding";

export function pluginSettingsPermission(
  plugin: PluginMetadata | undefined
): string {
  return plugin?.settings?.permission ?? UPDATE_SETTINGS;
}
