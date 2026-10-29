import type { PluginMetadata } from "@admin/types/branding";

/**
 * What a plugin is called in the admin: its sidebar label, else its name. One
 * rule for every place that names a plugin (its page's heading and browser
 * tab, and its group on the roles screen), so none can name it differently.
 * Overloaded so a found plugin always yields a name.
 */
export function pluginDisplayName(plugin: PluginMetadata): string;
export function pluginDisplayName(
  plugin: PluginMetadata | undefined
): string | undefined;
export function pluginDisplayName(
  plugin: PluginMetadata | undefined
): string | undefined {
  return plugin && (plugin.appearance?.label ?? plugin.name);
}
