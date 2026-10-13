/**
 * The permission a plugin's settings take: core's `manage-settings`, unless
 * the plugin names one of its own in `contributes.settingsPermission`.
 *
 * One module for the boot's check and the request's gate, so the permission
 * the boot accepted is the one the gate asks for.
 *
 * @module plugins/settings-permission
 */
import { permissionSlug } from "../schemas/_zod/rbac";

import type { PluginDefinition } from "./plugin-context";
import { resolutionError } from "./resolution-error";
import { parsePermissionSlug } from "./routes/permission-slug";

/**
 * Refuse a `settingsPermission` that is not one of the plugin's own declared
 * permissions, or that a plugin declares without settings to guard.
 *
 * Without this, a misspelt name boots, and the settings can then be changed
 * by nobody but the super-admin: a role granted what the operator believes
 * is the permission holds a different one, and the refusal looks exactly
 * like a role that was never meant to have it.
 */
export function assertSettingsPermissions(plugins: PluginDefinition[]): void {
  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    const declared = plugin.contributes?.settingsPermission;
    if (declared === undefined) continue;
    if (!plugin.contributes?.settings) {
      throw resolutionError(
        "settings-permission-without-settings",
        `Plugin "${plugin.name}" declares settingsPermission "${declared}" but no settings schema for it to guard.`,
        { plugin: plugin.name, settingsPermission: declared }
      );
    }
    const own = (plugin.contributes.permissions ?? []).map(permission =>
      permissionSlug(permission.action, permission.resource)
    );
    if (!own.includes(declared)) {
      throw resolutionError(
        "settings-permission-undeclared",
        `Plugin "${plugin.name}" declares settingsPermission "${declared}", which is not one of its own permissions (${own.length > 0 ? own.join(", ") : "it declares none"}).`,
        { plugin: plugin.name, settingsPermission: declared }
      );
    }
  }
}

/**
 * The permission a write to this plugin's settings needs, as the gate asks
 * for it. `undefined` when the plugin names none, or is not one of these, so
 * the gate keeps core's `manage-settings`.
 */
export function settingsWritePermission(
  plugins: readonly PluginDefinition[] | undefined,
  pluginName: string | undefined
): { action: string; resource: string } | undefined {
  const declared = plugins?.find(plugin => plugin.name === pluginName)
    ?.contributes?.settingsPermission;
  return declared === undefined ? undefined : parsePermissionSlug(declared);
}
