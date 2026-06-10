import type { PluginDefinition } from "./plugin-context";
import { topoSortPlugins } from "./topo-sort";
import { validatePluginVersions } from "./validate-versions";

export interface ResolvePluginsOptions {
  /**
   * Concrete running core version, e.g. "0.0.2-alpha.21". Supplied by the caller;
   * P1 wires the runtime source (CLI + register).
   */
  coreVersion: string;
}

/**
 * The single shared plugin resolver used by both the CLI and the runtime (D6).
 * Validates compatibility (D6), then returns dependency order (D5). Fail-fast (D7).
 *
 * Pure — NOT yet wired into boot. P1 calls this from `register.ts` (runtime) and
 * `config-loader.ts` (CLI).
 */
export function resolvePlugins(
  plugins: PluginDefinition[],
  opts: ResolvePluginsOptions
): PluginDefinition[] {
  validatePluginVersions(plugins, opts.coreVersion);
  return topoSortPlugins(plugins);
}
