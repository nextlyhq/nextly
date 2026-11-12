import { APP_OWNER } from "./permissions/collect-permissions";
import type { PluginDefinition } from "./plugin-context";
import { resolutionError } from "./resolution-error";

/**
 * Boot-check that no plugin is named after the owner key the site's own
 * permissions are stored under. Throws fail-fast.
 *
 * A plugin's permissions are stored with the plugin's name as their owner, and
 * the site's with `APP_OWNER`. A plugin named `app` would share that key, and
 * nothing that later reads the stored owner could tell the two apart:
 * uninstalling the plugin, the orphan pass of `nextly migrate` and a
 * `migrate:down` rollback would each take the site's permissions for the
 * plugin's, or the plugin's for the site's. So the name is reserved here,
 * where every boot and every command resolves the plugin list, rather than
 * the owner carrying a second field to say which kind it is.
 *
 * Compared without regard to case: owner keys are compared by the database,
 * and MySQL's default collation compares them that way, so `App` reaches the
 * same rows as `app`. Disabled plugins are checked too, since a disabled
 * plugin keeps its schema and its stored permissions.
 *
 * @module plugins/validate-names
 */
export function validatePluginNames(plugins: PluginDefinition[]): void {
  for (const plugin of plugins) {
    // A name that is not a string is not this check's to judge, and must not
    // fail here as a TypeError before the checks that name it can.
    if (typeof plugin.name !== "string") continue;
    if (plugin.name.toLowerCase() !== APP_OWNER) continue;
    throw resolutionError(
      "plugin-name-reserved",
      `Plugin "${plugin.name}" uses the name "${APP_OWNER}", which is reserved for the site's own permissions. Choose another name for the plugin.`,
      { plugin: plugin.name, reservedName: APP_OWNER }
    );
  }
}
