/**
 * The permission a plugin's settings take: core's `update-settings`, unless
 * the plugin names one of its own in `contributes.settingsPermission`.
 *
 * One module for the boot's check and the request's gate, so the permission
 * the boot accepted is the one the gate asks for.
 *
 * @module plugins/settings-permission
 */
import {
  type CollectedPermission,
  isAdoptedLifecyclePermission,
} from "./permissions/collect-permissions";
import type { PluginDefinition } from "./plugin-context";
import { resolutionError } from "./resolution-error";
import { parsePermissionSlug } from "./routes/permission-slug";

/**
 * Refuse a `settingsPermission` declared by a plugin with no settings to
 * guard. A question of the manifest alone, so it is asked with the plugin's
 * other manifest checks; whether the permission is the plugin's own needs the
 * entities too, and is {@link assertSettingsPermissionsOwned}.
 */
export function assertSettingsPermissionsGuardSettings(
  plugins: PluginDefinition[]
): void {
  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    const declared = plugin.contributes?.settingsPermission;
    if (declared === undefined || plugin.contributes?.settings) continue;
    throw resolutionError(
      "settings-permission-without-settings",
      `Plugin "${plugin.name}" declares settingsPermission "${declared}" but no settings schema for it to guard.`,
      { plugin: plugin.name, settingsPermission: declared }
    );
  }
}

/**
 * Refuse a `settingsPermission` that is not one of the plugin's own
 * permissions as the permission collector keeps them.
 *
 * Without this, a misspelt name boots, and the settings can then be changed
 * by nobody but the super-admin: a role granted what the operator believes
 * is the permission holds a different one, and the refusal looks exactly
 * like a role that was never meant to have it.
 *
 * Judged against what is collected, not the raw manifest, because the two
 * differ exactly where it matters: a `publish` or `unpublish` a plugin
 * declares on a collection or Single is the seeder's permission, granted to
 * every content publisher, and the collector drops it. Read from the manifest
 * it passed, and every publisher could change the plugin's credentials. The
 * collector judges the config's entities; a Schema Builder entity, which the
 * seeder treats the same way once it is stored, is in `builderEntitySlugs`.
 */
export function assertSettingsPermissionsOwned(
  plugins: readonly PluginDefinition[],
  collected: readonly CollectedPermission[],
  builderEntitySlugs: Iterable<string>
): void {
  const builder = new Set<string>();
  for (const slug of builderEntitySlugs) builder.add(slug.toLowerCase());
  for (const plugin of plugins) {
    if (plugin.enabled === false) continue;
    const declared = plugin.contributes?.settingsPermission;
    if (declared === undefined) continue;
    const own = collected
      .filter(
        permission =>
          permission.source === "plugin" &&
          permission.owner === plugin.name &&
          !isAdoptedLifecyclePermission(
            permission.action,
            permission.resource,
            builder
          )
      )
      .map(permission => permission.slug);
    if (!own.includes(declared)) {
      throw resolutionError(
        "settings-permission-undeclared",
        `Plugin "${plugin.name}" declares settingsPermission "${declared}", which is not one of its own permissions (${own.length > 0 ? own.join(", ") : "it owns none"}).`,
        { plugin: plugin.name, settingsPermission: declared }
      );
    }
  }
}

/**
 * Core's permission for a plugin's settings, kept unless the plugin names its
 * own: a settings change, `update-settings`, as the system write policy names
 * it (`SYSTEM_WRITE_POLICY.settings.update`). A role still holding
 * `manage-settings` holds it, since that counts as the plain four on
 * settings.
 */
export const CORE_SETTINGS_PERMISSION = "update-settings";

/**
 * The permission a change to this plugin's settings needs, as a slug: the
 * plugin's own `settingsPermission`, or core's `update-settings`.
 *
 * The one answer the request gate enforces and the admin metadata publishes
 * for the settings page to ask for, so the page never offers an editor the
 * gate then refuses, nor refuses a caller the gate would admit.
 */
export function settingsPermissionOf(
  plugin: PluginDefinition | undefined
): string {
  return plugin?.contributes?.settingsPermission ?? CORE_SETTINGS_PERMISSION;
}

/**
 * The permission a write to this plugin's settings needs, split as the gate
 * checks it. Core's `update-settings` for a plugin that names none, or that
 * is not one of these.
 */
export function settingsWritePermission(
  plugins: readonly PluginDefinition[] | undefined,
  pluginName: string | undefined
): { action: string; resource: string } {
  return parsePermissionSlug(
    settingsPermissionOf(plugins?.find(plugin => plugin.name === pluginName))
  );
}
