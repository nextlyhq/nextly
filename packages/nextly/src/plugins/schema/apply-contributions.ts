/**
 * Fold plugin schema contributions into the merged config (code-first lane).
 *
 * Pure function: appends each plugin's `contributes.{collections,singles,
 * components}` to the config's own arrays so the downstream merge/migration/
 * sync machinery treats them like ordinary code-first entities (D3/D12). Runs
 * over ALL plugins — including disabled ones — so declarative schema stays
 * deterministic across environments (D49).
 *
 * Called at the same post-`setup` seam by both the runtime boot
 * (`di/register.ts`) and the CLI (`cli/utils/config-loader.ts`), which is what
 * keeps the two paths in agreement (D50).
 *
 * @module plugins/schema/apply-contributions
 */

import type { NextlyServiceConfig } from "../../di/register";
import type { PluginDefinition } from "../plugin-context";

/**
 * @experimental Merge plugin `contributes` schema into the config. Pure — does
 * not mutate `config` or `plugins`.
 */
export function applyPluginSchemaContributions(
  config: NextlyServiceConfig,
  plugins: PluginDefinition[]
): NextlyServiceConfig {
  const collections = [...(config.collections ?? [])];
  const singles = [...(config.singles ?? [])];
  const components = [...(config.components ?? [])];

  for (const plugin of plugins) {
    const contributes = plugin.contributes;
    if (!contributes) continue;
    if (contributes.collections) collections.push(...contributes.collections);
    if (contributes.singles) singles.push(...contributes.singles);
    if (contributes.components) components.push(...contributes.components);
  }

  return { ...config, collections, singles, components };
}
