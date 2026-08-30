import type { PluginDefinition } from "./plugin-context";
import { topoSortPlugins } from "./topo-sort";
import { assertAdminWidgets } from "./validate-admin-widgets";
import { assertClientConfigs } from "./validate-client-config";
import { validatePluginSlugs } from "./validate-slugs";
import { validatePluginVersions } from "./validate-versions";

export interface ResolvePluginsOptions {
  /**
   * Concrete running core version, e.g. "0.0.2-alpha.21". Supplied by the caller;
   * P1 wires the runtime source (CLI + register).
   */
  coreVersion: string;
}

/**
 * The single shared plugin resolver used by both the CLI and the runtime.
 * Validates compatibility, then returns dependency order. Fail-fast.
 *
 * Pure — NOT yet wired into boot. P1 calls this from `register.ts` (runtime) and
 * `config-loader.ts` (CLI).
 */
export function resolvePlugins(
  plugins: PluginDefinition[],
  opts: ResolvePluginsOptions
): PluginDefinition[] {
  validatePluginVersions(plugins, opts.coreVersion);
  // Before anything reads it. A `clientConfig` that cannot be delivered is a
  // configuration error like an incompatible version, so it belongs with the
  // other fail-fast checks rather than surfacing when the admin first asks for
  // its metadata and losing the whole branding response with it.
  assertClientConfigs(plugins);
  // Beside it, and for the same reason one level up: a contributed widget rides
  // in the SAME `/api/admin-meta/workspace` payload, through the same single
  // `JSON.stringify`. A bigint under `query.where` is type-legal there, so the
  // throw lands on the workspace response for every admin rather than on the
  // one card -- which is a worse failure than a bad `clientConfig`, not a
  // lesser one.
  assertAdminWidgets(plugins);
  // Two plugins sharing an admin slug share an address, and nothing downstream
  // can detect it: every lookup along that address returns a plugin, which is
  // what a correct lookup returns. Registration is where the ambiguity is still
  // observable.
  validatePluginSlugs(plugins);
  return topoSortPlugins(plugins);
}
