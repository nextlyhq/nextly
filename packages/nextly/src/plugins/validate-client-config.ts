/**
 * Validating a plugin's `contributes.admin.clientConfig` and reducing it to the
 * value the browser receives.
 *
 * Its own module because two callers need it at different times: boot rejects a
 * bad config before anything depends on it, and the admin-meta serializer needs
 * the reduced value. One implementation, so the request path cannot accept what
 * boot refused.
 *
 * The round trip itself lives in `./json-round-trip`, shared with the widget
 * contributions that cross the same boundary in the same response.
 *
 * @module plugins/validate-client-config
 */

import { clientConfigError } from "./client-config-error";
import { jsonOnly, unserializableKeys } from "./json-round-trip";
import type { PluginDefinition } from "./plugin-context";

/**
 * The config a plugin will publish, or `undefined` when it declares none.
 *
 * Throws {@link clientConfigError} when the value cannot be delivered
 * unchanged.
 */
export function validatedClientConfig(
  plugin: PluginDefinition
): Record<string, unknown> | undefined {
  const declared = plugin.contributes?.admin?.clientConfig;
  if (declared === undefined) return undefined;
  // Declared as `object` so an author's ordinary interface is accepted at the
  // call site; the runtime check below is what decides, and it refuses
  // anything that is not a plain JSON object.
  const serializable = jsonOnly(declared);
  if (serializable === undefined) {
    throw clientConfigError(plugin.name, unserializableKeys(declared));
  }
  return serializable;
}

/**
 * Boot-time check over every plugin, disabled ones included.
 *
 * Validating only when `/api/admin-meta` is first requested would make a bad
 * config look like a healthy start followed by an endpoint that takes the whole
 * branding payload down with it — and the contract promises a boot error.
 * Disabled plugins are checked too, because their config is serialized too.
 */
export function assertClientConfigs(plugins: PluginDefinition[]): void {
  for (const plugin of plugins) validatedClientConfig(plugin);
}
